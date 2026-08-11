import { readFileSync } from "node:fs";
import path from "node:path";
import superjson from "superjson";
import type { CheckinOutcome } from "@ovation/core/schemas";
// Static, not dynamic: Playwright's CJS transpile cannot resolve a dynamic
// import of a workspace-relative module at runtime.
import { signQrToken } from "../src/server/live/qr";

// Playwright transpiles specs to CJS, so `import.meta` is off the table here.
// The runner's cwd is apps/live; walk up to the workspace root for `.env`.
loadEnv(path.resolve(process.cwd(), "../../.env"));

export const BASE = (process.env.SIM_URL ?? "http://127.0.0.1:3002").replace(
  /\/$/,
  "",
);

const KEY = process.env.LIVE_OPS_KEY ?? null;

function loadEnv(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    if (process.env[key] !== undefined) continue;
    process.env[key] = (match[2] as string).replace(/^["']|["']$/g, "");
  }
}

function headers(extra: Record<string, string> = {}) {
  return { ...(KEY ? { "x-ovation-live-key": KEY } : {}), ...extra };
}

export interface DoorGuest {
  id: string;
  name: string;
  company: string | null;
  segment: string;
  checkedInAt: string | null;
}

export interface DoorList {
  event: { id: string; title: string; capacity: number };
  guests: DoorGuest[];
}

export async function doorList(eventId?: string): Promise<DoorList> {
  const res = await fetch(
    `${BASE}/api/live/doorlist${eventId ? `?eventId=${eventId}` : ""}`,
    { headers: headers() },
  );
  if (!res.ok) throw new Error(`doorlist → ${res.status}`);
  return (await res.json()) as DoorList;
}

/** A check-in fired the way a second door tablet would fire it. */
export async function checkinOverHttp(input: {
  eventId: string;
  guestId: string;
  lane?: string;
  idempotencyKey?: string;
}): Promise<CheckinOutcome> {
  const res = await fetch(`${BASE}/api/trpc/live.checkin`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify(
      superjson.serialize({
        eventId: input.eventId,
        token: await signQrToken({ gid: input.guestId, eid: input.eventId }),
        lane: input.lane ?? "e2e",
        deviceId: "e2e",
        idempotencyKey:
          input.idempotencyKey ?? `e2e-${input.guestId}-${Date.now()}`,
        offlineSynced: false,
      }),
    ),
  });
  const body = (await res.json()) as {
    result?: { data: unknown };
    error?: { json?: { message?: string } };
  };
  if (body.error) throw new Error(body.error.json?.message ?? "checkin failed");
  return (
    superjson.deserialize(body.result!.data as never) as {
      outcome: CheckinOutcome;
    }
  ).outcome;
}

export async function checkedInCount(eventId: string): Promise<number> {
  const list = await doorList(eventId);
  return list.guests.filter((g) => g.checkedInAt).length;
}

export async function resetEvent(eventId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/live/dev/reset?eventId=${eventId}`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`reset → ${res.status}`);
}
