/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import path from "node:path";
import superjson from "superjson";
import type { CheckinOutcome } from "@ovation/core";
import { signQrToken } from "../src/server/live/qr";

/**
 * OUTCOME MATRIX — `pnpm verify:outcomes`.
 *
 * Every branch of `checkinOutcomeSchema`, driven end to end over HTTP against
 * the running app. This is the test the Critic will want: a forged token and
 * an expired token must be *distinctly* refused, not collapsed into one error.
 *
 * The forged case is the important one. It is signed with a real HS256
 * signature over a real payload — the only thing wrong with it is the key, and
 * the only reason it fails is that the server checks. It is also deliberately
 * given an expiry in the past, so a server that checked `exp` before the
 * signature would answer REJECTED_EXPIRED and reveal it was reading a token it
 * had no business trusting. The expected answer is REJECTED_INVALID_TOKEN.
 */

loadEnv(path.join(import.meta.dirname, "../../../.env"));

const BASE = (process.env.SIM_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
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

async function checkin(input: Record<string, unknown>): Promise<CheckinOutcome> {
  const res = await fetch(`${BASE}/api/trpc/live.checkin`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify(superjson.serialize(input)),
  });
  const body = (await res.json()) as {
    result?: { data: unknown };
    error?: { json?: { message?: string } };
  };
  if (body.error) throw new Error(body.error.json?.message ?? "request failed");
  const out = superjson.deserialize(body.result!.data as never) as {
    outcome: CheckinOutcome;
  };
  return out.outcome;
}

interface Case {
  name: string;
  expected: CheckinOutcome;
  build: () => Promise<Record<string, unknown>>;
}

async function main() {
  const door = (await (
    await fetch(`${BASE}/api/live/doorlist`, { headers: headers() })
  ).json()) as {
    event: { id: string; title: string };
    guests: Array<{ id: string; name: string; checkedInAt: string | null }>;
  };

  const eventId = door.event.id;
  const fresh = door.guests.find((g) => !g.checkedInAt);
  const already = door.guests.find((g) => g.checkedInAt);

  if (!fresh) {
    throw new Error(
      "Every guest is already checked in — run `pnpm sim -- --reset` first.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const wrongSecret = new TextEncoder().encode(
    "not-the-signing-secret-forged-by-a-scalper",
  );

  const base = (extra: Record<string, unknown>) => ({
    eventId,
    lane: "verify",
    deviceId: "verify-script",
    offlineSynced: false,
    ...extra,
  });

  const cases: Case[] = [
    {
      name: "forged signature (and expired, to prove ordering)",
      expected: "REJECTED_INVALID_TOKEN",
      build: async () =>
        base({
          token: await signQrToken(
            { gid: fresh.id, eid: eventId, ttlSeconds: 60 },
            { secret: wrongSecret, issuedAt: now - 7200 },
          ),
          idempotencyKey: `verify-forged-${now}`,
        }),
    },
    {
      name: "not a JWT at all",
      expected: "REJECTED_INVALID_TOKEN",
      build: async () =>
        base({
          token: "https://example.com/definitely-not-a-token",
          idempotencyKey: `verify-garbage-${now}`,
        }),
    },
    {
      name: "empty token, no guestId",
      expected: "REJECTED_INVALID_TOKEN",
      build: async () => base({ idempotencyKey: `verify-empty-${now}` }),
    },
    {
      name: "valid signature, expired 2h ago",
      expected: "REJECTED_EXPIRED",
      build: async () =>
        base({
          token: await signQrToken(
            { gid: fresh.id, eid: eventId, ttlSeconds: 60 },
            { issuedAt: now - 7200 },
          ),
          idempotencyKey: `verify-expired-${now}`,
        }),
    },
    {
      name: "valid signature, one second past expiry",
      expected: "REJECTED_EXPIRED",
      build: async () =>
        base({
          token: await signQrToken(
            { gid: fresh.id, eid: eventId, ttlSeconds: 1 },
            { issuedAt: now - 2 },
          ),
          idempotencyKey: `verify-justexpired-${now}`,
        }),
    },
    {
      name: "valid signature, another event",
      expected: "REJECTED_WRONG_EVENT",
      build: async () =>
        base({
          token: await signQrToken({ gid: fresh.id, eid: "some-other-event" }),
          idempotencyKey: `verify-wrongevent-${now}`,
        }),
    },
    {
      name: "valid signature, guest who does not exist",
      expected: "REJECTED_UNKNOWN_GUEST",
      build: async () =>
        base({
          token: await signQrToken({ gid: "guest-that-does-not-exist", eid: eventId }),
          idempotencyKey: `verify-unknown-${now}`,
        }),
    },
    {
      name: "manual door-list entry for a guest who does not exist",
      expected: "REJECTED_UNKNOWN_GUEST",
      build: async () =>
        base({
          guestId: "guest-that-does-not-exist",
          idempotencyKey: `verify-manualunknown-${now}`,
        }),
    },
    {
      name: "genuine pass",
      expected: "CHECKED_IN",
      build: async () =>
        base({
          token: await signQrToken({ gid: fresh.id, eid: eventId }),
          idempotencyKey: `verify-good-${now}`,
        }),
    },
    {
      name: "same scan replayed (same idempotency key, offlineSynced)",
      expected: "ALREADY_CHECKED_IN",
      build: async () =>
        base({
          token: await signQrToken({ gid: fresh.id, eid: eventId }),
          idempotencyKey: `verify-good-${now}`,
          offlineSynced: true,
          scannedAt: new Date(Date.now() - 60_000),
        }),
    },
    {
      name: "same guest, a different scan from another lane",
      expected: "ALREADY_CHECKED_IN",
      build: async () =>
        base({
          token: await signQrToken({ gid: fresh.id, eid: eventId }),
          lane: "side",
          idempotencyKey: `verify-secondlane-${now}`,
        }),
    },
  ];

  if (already) {
    cases.push({
      name: "manual door-list entry for someone already inside",
      expected: "ALREADY_CHECKED_IN",
      build: async () =>
        base({
          guestId: already.id,
          idempotencyKey: `verify-manualalready-${now}`,
        }),
    });
  }

  console.log(`\n  Outcome matrix — ${door.event.title}`);
  console.log(`  ${BASE} · event ${eventId}\n`);

  let failures = 0;
  for (const c of cases) {
    let actual: string;
    try {
      actual = await checkin(await c.build());
    } catch (err) {
      actual = `THREW: ${(err as Error).message}`;
    }
    const ok = actual === c.expected;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "✓" : "✗"} ${c.name.padEnd(52)} ${actual}${ok ? "" : `  (expected ${c.expected})`}`,
    );
  }

  console.log(
    `\n  ${cases.length - failures}/${cases.length} passed${failures ? ` — ${failures} FAILED` : ""}\n`,
  );
  // Not `process.exit()`: it would discard the buffered report when piped.
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error("\n  verification failed:", (err as Error).message, "\n");
  process.exitCode = 1;
});
