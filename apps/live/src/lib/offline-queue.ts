import type { CheckinOutcome } from "@ovation/core/schemas";
import {
  STORE_CACHE,
  STORE_QUEUE,
  idbAvailable,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
} from "./idb";

/**
 * THE SYNC QUEUE.
 *
 * A scan taken in a dead-zone is written here first and sent later. Three
 * things make the replay safe:
 *
 *  - **A stable idempotency key**, generated once at scan time and reused for
 *    every attempt. The server keys off it, and off the unique constraint on
 *    CheckIn.guestId, so the second application returns ALREADY_CHECKED_IN
 *    instead of a second row.
 *  - **scannedAt**, captured at the moment the code was read. The check-in row
 *    records when the guest walked in, not when the tunnel ended. Arrival
 *    curves and the "who was in the room at 19:15" question both depend on it.
 *  - **Idempotent local state.** An entry stays `pending` until the server has
 *    answered; a reload mid-flight re-sends rather than losing the scan.
 *
 * The queue is drained on reconnect, on an interval, and on demand. Draining
 * is serialised — a burst of parallel replays would only fight over the same
 * unique index.
 */

export type QueueState = "pending" | "synced" | "failed";

export interface QueuedScan {
  idempotencyKey: string;
  eventId: string;
  token?: string;
  guestId?: string;
  lane: string;
  deviceId: string;
  /** ISO. When the code was read, not when it was sent. */
  scannedAt: string;
  state: QueueState;
  attempts: number;
  lastError?: string;
  /** Server-authoritative outcome, once it has one. */
  outcome?: CheckinOutcome;
  guestName?: string;
}

export interface SyncResult {
  key: string;
  outcome: CheckinOutcome;
  guestName: string | null;
}

const CACHE_KEY_DOORLIST = (eventId: string) => `doorlist:${eventId}`;

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function deviceId(): string {
  if (typeof localStorage === "undefined") return "unknown-device";
  let id = localStorage.getItem("ovation.deviceId");
  if (!id) {
    id = newIdempotencyKey();
    localStorage.setItem("ovation.deviceId", id);
  }
  return id;
}

export async function enqueue(scan: QueuedScan): Promise<void> {
  if (!idbAvailable()) return;
  await idbPut(STORE_QUEUE, scan);
}

export async function allScans(): Promise<QueuedScan[]> {
  if (!idbAvailable()) return [];
  const rows = await idbGetAll<QueuedScan>(STORE_QUEUE);
  return rows.sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
}

export async function pendingScans(eventId?: string): Promise<QueuedScan[]> {
  const rows = await allScans();
  return rows.filter(
    (r) => r.state === "pending" && (!eventId || r.eventId === eventId),
  );
}

export async function markSynced(
  key: string,
  outcome: CheckinOutcome,
  guestName: string | null,
): Promise<void> {
  const row = await idbGet<QueuedScan>(STORE_QUEUE, key);
  if (!row) return;
  await idbPut(STORE_QUEUE, {
    ...row,
    state: "synced" satisfies QueueState,
    outcome,
    guestName: guestName ?? row.guestName,
  });
}

export async function markFailed(key: string, error: string): Promise<void> {
  const row = await idbGet<QueuedScan>(STORE_QUEUE, key);
  if (!row) return;
  await idbPut(STORE_QUEUE, {
    ...row,
    attempts: row.attempts + 1,
    lastError: error,
  });
}

export async function forget(key: string): Promise<void> {
  await idbDelete(STORE_QUEUE, key);
}

/** Drop synced rows older than an hour; the audit trail lives server-side. */
export async function prune(): Promise<void> {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const row of await allScans()) {
    if (row.state === "synced" && Date.parse(row.scannedAt) < cutoff) {
      await idbDelete(STORE_QUEUE, row.idempotencyKey);
    }
  }
}

// ── cached door list ──────────────────────────────────────────

export interface CachedGuest {
  id: string;
  name: string;
  email: string;
  company: string | null;
  segment: string;
  rsvpStatus: string;
  plusOnes: number;
  dietary: string | null;
  whiteGloveNotes: string[];
  conversationOpener: string | null;
  checkedInAt: string | null;
  lane: string | null;
}

export interface CachedDoorList {
  key: string;
  fetchedAt: string;
  event: { id: string; title: string; capacity: number; venue: string };
  guests: CachedGuest[];
}

export async function saveDoorList(
  eventId: string,
  payload: Omit<CachedDoorList, "key">,
): Promise<void> {
  if (!idbAvailable()) return;
  await idbPut(STORE_CACHE, { key: CACHE_KEY_DOORLIST(eventId), ...payload });
}

export async function loadDoorList(
  eventId: string,
): Promise<CachedDoorList | undefined> {
  if (!idbAvailable()) return undefined;
  return idbGet<CachedDoorList>(STORE_CACHE, CACHE_KEY_DOORLIST(eventId));
}

/**
 * Locally recorded arrivals, so a second scan of the same code in a dead-zone
 * reads ALREADY_CHECKED_IN on the spot instead of queueing a duplicate.
 */
export async function locallyCheckedIn(eventId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const list = await loadDoorList(eventId);
  for (const g of list?.guests ?? []) if (g.checkedInAt) ids.add(g.id);
  for (const scan of await allScans()) {
    if (scan.eventId !== eventId || !scan.guestId) continue;
    if (scan.outcome && scan.outcome.startsWith("REJECTED")) continue;
    ids.add(scan.guestId);
  }
  return ids;
}
