/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import path from "node:path";
import superjson from "superjson";
import type { CheckinOutcome, LiveEvent, OpsSnapshot } from "@ovation/core";
import { signQrToken } from "../src/server/live/qr";

/**
 * SIMULATION MODE — `pnpm sim`.
 *
 * Streams fake arrivals from the seeded guest list **through the real
 * pipeline**: real HS256-signed QR tokens, real HTTP, the real tRPC
 * procedure, real Prisma writes, real fan-out. Nothing is mocked, and the
 * harness deliberately holds no database handle of its own — everything it
 * knows, it learned from the app the same way a door tablet would. If it can
 * measure something, the product can serve it.
 *
 * What it measures:
 *
 *  1. **Check-in latency**, client-observed, as P50/P95/P99, printed next to
 *     the server's own histogram. The gap between the two is the network.
 *  2. **Dropped socket updates**, by subscribing to the ops feed and
 *     reconciling every CHECKIN frame against the scans it sent. Sequence
 *     numbers make a gap detectable even if a whole burst is lost.
 *  3. **Announcement latency**, end to end: push one, time it to the socket.
 *  4. **Replay idempotency** (`--replay`): re-send every scan with the same
 *     idempotency keys and assert the check-in count does not move.
 *
 * Usage:
 *   pnpm sim                            250 arrivals over 10 minutes
 *   pnpm sim -- --count 40 --minutes 1
 *   pnpm sim -- --burst --count 250     as fast as the pipeline will take them
 *   pnpm sim -- --reset --replay        clean room, then prove replay is safe
 */

loadEnv(path.join(import.meta.dirname, "../../../.env"));

interface Options {
  url: string;
  eventId: string | null;
  count: number;
  minutes: number;
  lanes: string[];
  burst: boolean;
  reset: boolean;
  replay: boolean;
  concurrency: number;
  key: string | null;
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(`--${flag}`);
    return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : null;
  };
  const has = (flag: string) => argv.includes(`--${flag}`);

  return {
    url: (get("url") ?? process.env.SIM_URL ?? "http://127.0.0.1:3002").replace(
      /\/$/,
      "",
    ),
    eventId: get("event"),
    count: Number(get("count") ?? 250),
    minutes: Number(get("minutes") ?? 10),
    lanes: (get("lanes") ?? "main,side,vip").split(","),
    burst: has("burst"),
    reset: has("reset"),
    replay: has("replay"),
    concurrency: Number(get("concurrency") ?? 6),
    key: get("key") ?? process.env.LIVE_OPS_KEY ?? null,
  };
}

/**
 * The app gets .env through Next; a bare tsx process does not. Never clobbers
 * a variable the caller set on the command line.
 */
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

// ── transport ─────────────────────────────────────────────────

interface DoorList {
  event: { id: string; title: string; capacity: number; venue: string };
  guests: Array<{
    id: string;
    name: string;
    segment: string;
    checkedInAt: string | null;
  }>;
}

class Client {
  constructor(
    private base: string,
    private key: string | null,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...(this.key ? { "x-ovation-live-key": this.key } : {}),
      ...extra,
    };
  }

  /** One unbatched tRPC mutation, superjson-encoded exactly as the browser sends it. */
  async mutate<T>(procedure: string, input: unknown): Promise<T> {
    const res = await fetch(`${this.base}/api/trpc/${procedure}`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(superjson.serialize(input)),
    });
    const body = (await res.json()) as {
      result?: { data: unknown };
      error?: { json?: { message?: string }; message?: string };
    };
    if (body.error) {
      throw new Error(
        body.error.json?.message ?? body.error.message ?? `HTTP ${res.status}`,
      );
    }
    if (!res.ok || !body.result) throw new Error(`HTTP ${res.status}`);
    return superjson.deserialize(body.result.data as never) as T;
  }

  async query<T>(procedure: string, input: unknown): Promise<T> {
    const encoded = encodeURIComponent(JSON.stringify(superjson.serialize(input)));
    const res = await fetch(
      `${this.base}/api/trpc/${procedure}?input=${encoded}`,
      { headers: this.headers() },
    );
    const body = (await res.json()) as {
      result?: { data: unknown };
      error?: { json?: { message?: string }; message?: string };
    };
    if (body.error) {
      throw new Error(body.error.json?.message ?? `HTTP ${res.status}`);
    }
    return superjson.deserialize(body.result!.data as never) as T;
  }

  async get<T>(pathname: string): Promise<T> {
    const res = await fetch(`${this.base}${pathname}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GET ${pathname} → ${res.status}`);
    return (await res.json()) as T;
  }

  async post<T>(pathname: string): Promise<T> {
    const res = await fetch(`${this.base}${pathname}`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`POST ${pathname} → ${res.status}`);
    return (await res.json()) as T;
  }

  async del(pathname: string): Promise<void> {
    await fetch(`${this.base}${pathname}`, {
      method: "DELETE",
      headers: this.headers(),
    });
  }
}

interface Received {
  seq: number;
  at: number;
  receivedAt: number;
  event: LiveEvent;
}

/** Reads the SSE feed and records every frame with its sequence number. */
async function openFeed(
  base: string,
  eventId: string,
  channel: string,
  key: string | null,
  sink: (r: Received) => void,
  signal: AbortSignal,
): Promise<void> {
  const url = `${base}/api/live/stream?eventId=${encodeURIComponent(eventId)}&channel=${channel}`;
  const res = await fetch(url, {
    headers: key ? { "x-ovation-live-key": key } : {},
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`feed → ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      if (!frame.startsWith("event: live")) continue;
      const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      try {
        sink({
          ...(JSON.parse(dataLine.slice(6)) as Omit<Received, "receivedAt">),
          receivedAt: Date.now(),
        });
      } catch {
        console.warn("  ! unparseable feed frame");
      }
    }
  }
}

// ── helpers ───────────────────────────────────────────────────

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const line = (s = "") => console.log(s);
const verdict = (ok: boolean, good: string, bad: string) =>
  ok ? `✓ ${good}` : `✗ ${bad}`;

// ── the run ───────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const client = new Client(opts.url, opts.key);

  let door: DoorList;
  try {
    door = await client.get<DoorList>(
      `/api/live/doorlist${opts.eventId ? `?eventId=${opts.eventId}` : ""}`,
    );
  } catch (err) {
    throw new Error(
      `Cannot reach ${opts.url} (${(err as Error).message}). Start it with \`pnpm --filter @ovation/live dev\`.`,
    );
  }

  const event = door.event;
  line();
  line(`  OVATION simulation — ${event.title}`);
  line(`  target ${opts.url} · event ${event.id}`);
  line();

  if (opts.reset) {
    const res = await client.post<{ removed: number }>(
      `/api/live/dev/reset?eventId=${event.id}`,
    );
    line(`  reset: removed ${res.removed} check-ins`);
    line();
    door = await client.get<DoorList>(`/api/live/doorlist?eventId=${event.id}`);
  }

  const pool = door.guests.filter((g) => !g.checkedInAt).slice(0, opts.count);
  if (pool.length === 0) {
    throw new Error("Everyone is already checked in. Re-run with --reset.");
  }
  if (pool.length < opts.count) {
    line(`  note: only ${pool.length} guests left to check in, asked for ${opts.count}`);
    line();
  }

  // Warm the route up before the clock starts. In `next dev` the first request
  // to a route compiles it, and a 4-second webpack build is not a check-in
  // latency — measuring it would be measuring the wrong thing.
  await client
    .mutate("live.checkin", {
      eventId: event.id,
      token: "warmup.not.a.token",
      lane: "warmup",
      idempotencyKey: `warmup-${event.id}`,
      offlineSynced: false,
    })
    .catch(() => undefined);

  await client.del("/api/live/metrics");

  // Feeds first, so nothing can arrive before we are listening. Two of them:
  // `ops` sees everything and is what the reconciliation counts, `guest-app`
  // is an addressable audience so the announcement has a real client to be
  // delivered to.
  const received: Received[] = [];
  const guestFrames: Received[] = [];
  const abort = new AbortController();
  const feeds = Promise.all([
    openFeed(opts.url, event.id, "ops", opts.key, (r) => received.push(r), abort.signal),
    openFeed(
      opts.url,
      event.id,
      "guest-app",
      opts.key,
      (r) => guestFrames.push(r),
      abort.signal,
    ),
  ]).catch((err) => {
    if (!abort.signal.aborted) console.error("  ! feed error:", err.message);
  });
  await sleep(600);

  // Pre-sign every token so JWT work sits outside the measured window.
  const scans = await Promise.all(
    pool.map(async (g, i) => ({
      guest: g,
      lane: opts.lanes[i % opts.lanes.length] as string,
      token: await signQrToken({ gid: g.id, eid: event.id }),
      idempotencyKey: `sim-${event.id}-${g.id}`,
    })),
  );

  const latencies: number[] = [];
  const outcomes = new Map<CheckinOutcome, number>();
  const errors: string[] = [];

  const send = async (scan: (typeof scans)[number], offlineSynced = false) => {
    const scannedAt = new Date();
    const t0 = performance.now();
    try {
      const result = await client.mutate<{ outcome: CheckinOutcome }>(
        "live.checkin",
        {
          eventId: event.id,
          token: scan.token,
          lane: scan.lane,
          deviceId: `sim-${scan.lane}`,
          idempotencyKey: scan.idempotencyKey,
          offlineSynced,
          scannedAt,
        },
      );
      latencies.push(performance.now() - t0);
      outcomes.set(result.outcome, (outcomes.get(result.outcome) ?? 0) + 1);
      return result.outcome;
    } catch (err) {
      errors.push((err as Error).message);
      return null;
    }
  };

  const started = Date.now();
  const spacingMs = opts.burst
    ? 0
    : (opts.minutes * 60_000) / Math.max(1, scans.length);

  line(
    opts.burst
      ? `  sending ${scans.length} scans as fast as ${opts.concurrency} lanes allow…`
      : `  sending ${scans.length} scans over ${opts.minutes} min (one every ${(spacingMs / 1000).toFixed(1)}s)…`,
  );

  if (opts.burst) {
    let cursor = 0;
    await Promise.all(
      Array.from({ length: opts.concurrency }, async () => {
        while (cursor < scans.length) {
          const scan = scans[cursor++];
          if (scan) await send(scan);
        }
      }),
    );
  } else {
    const inflight: Array<Promise<unknown>> = [];
    for (const [i, scan] of scans.entries()) {
      // Fire and continue: a real door does not wait for the previous guest's
      // round trip before scanning the next code.
      inflight.push(send(scan));
      if (i > 0 && i % 25 === 0) line(`  … ${i}/${scans.length}`);
      await sleep(spacingMs);
    }
    await Promise.all(inflight);
  }

  const elapsed = (Date.now() - started) / 1000;
  await sleep(800);

  // Announcement latency, measured against the socket rather than the reply.
  const announceMark = guestFrames.length;
  const announceStart = Date.now();
  const announced = await client
    .mutate<{ deliveredCount: number; announcementId: string }>(
      "live.announce",
      {
        eventId: event.id,
        title: "Simulation",
        body: "Dinner is served in the Salon Horta.",
        channels: ["guest-app", "host", "screens"],
      },
    )
    .catch((err) => {
      errors.push(`announce: ${(err as Error).message}`);
      return null;
    });
  await sleep(700);
  const announceFrame = guestFrames
    .slice(announceMark)
    .find((r) => r.event.kind === "ANNOUNCEMENT");

  // Replay: every scan again, same idempotency keys. Must not double-count.
  let replay: {
    before: number;
    after: number;
    outcomes: Record<string, number>;
  } | null = null;
  if (opts.replay) {
    const before = (
      await client.query<OpsSnapshot>("live.ops", { eventId: event.id })
    ).checkedIn;
    const replayOutcomes = new Map<string, number>();
    for (const scan of scans) {
      const outcome = await send(scan, true);
      if (outcome) {
        replayOutcomes.set(outcome, (replayOutcomes.get(outcome) ?? 0) + 1);
      }
    }
    const after = (
      await client.query<OpsSnapshot>("live.ops", { eventId: event.id })
    ).checkedIn;
    replay = {
      before,
      after,
      outcomes: Object.fromEntries(replayOutcomes),
    };
  }

  await sleep(400);
  abort.abort();
  await feeds;

  // ── reconciliation ──────────────────────────────────────────

  const checkinFrames = received.filter((r) => r.event.kind === "CHECKIN");
  const seenGuests = new Set(
    checkinFrames.map((r) => (r.event.kind === "CHECKIN" ? r.event.guestId : "")),
  );
  const succeeded = scans.filter((s) => seenGuests.has(s.guest.id)).length;
  const missing = scans.length - succeeded;

  const seqs = [...new Set(received.map((r) => r.seq))].sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 1; i < seqs.length; i++) {
    if ((seqs[i] as number) !== (seqs[i - 1] as number) + 1) gaps++;
  }

  const server = await client.get<{
    checkin: {
      count: number;
      p50: number;
      p95: number;
      p99: number;
      max: number;
      byOutcome: Record<string, number>;
    };
    realtime: { published: number; dropped: number };
  }>(`/api/live/metrics?eventId=${event.id}`);

  const p95 = percentile(latencies, 95);

  line();
  line("  ── check-in ────────────────────────────────────────");
  line(`    sent             ${scans.length} in ${elapsed.toFixed(1)}s`);
  line(`    outcomes         ${JSON.stringify(Object.fromEntries(outcomes))}`);
  line(`    errors           ${errors.length}${errors.length ? ` — ${errors[0]}` : ""}`);
  line();
  line(`    client p50       ${percentile(latencies, 50).toFixed(0)} ms`);
  line(`    client p95       ${p95.toFixed(0)} ms   ${verdict(p95 < 2500, "under 2.5s", "OVER BUDGET")}`);
  line(`    client p99       ${percentile(latencies, 99).toFixed(0)} ms`);
  line(`    client max       ${Math.max(0, ...latencies).toFixed(0)} ms`);
  line();
  line(`    server p50/p95   ${server.checkin.p50} / ${server.checkin.p95} ms`);
  line(`    server max       ${server.checkin.max} ms over ${server.checkin.count} samples`);
  line();
  line("  ── realtime ────────────────────────────────────────");
  line(`    frames received  ${received.length} (${checkinFrames.length} CHECKIN)`);
  line(`    unseen arrivals  ${missing}   ${verdict(missing === 0, "no dropped updates", "DROPPED")}`);
  line(`    sequence gaps    ${gaps}   ${verdict(gaps === 0, "contiguous", "GAP")}`);
  line(`    server dropped   ${server.realtime.dropped}`);
  line();
  line("  ── announcement ────────────────────────────────────");
  if (announced && announceFrame) {
    const ms = announceFrame.receivedAt - announceStart;
    line(
      `    delivered to     ${announced.deliveredCount} client(s) in ${ms} ms  ${verdict(ms < 1000, "under 1s", "OVER 1s")}`,
    );
  } else {
    line("    not observed on the feed");
  }
  if (replay) {
    line();
    line("  ── replay (same idempotency keys) ──────────────────");
    line(
      `    checked-in       ${replay.before} → ${replay.after}   ${verdict(replay.after === replay.before, "no duplicates", "DUPLICATED")}`,
    );
    line(`    outcomes         ${JSON.stringify(replay.outcomes)}`);
  }
  line();

  const failed =
    p95 >= 2500 ||
    missing > 0 ||
    gaps > 0 ||
    server.realtime.dropped > 0 ||
    (replay !== null && replay.after !== replay.before);

  // `process.exit()` would discard whatever is still buffered on stdout — and
  // when this is piped to a file, "whatever is still buffered" is the entire
  // report. Set the code and let the process end on its own.
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error("\n  simulation failed:", (err as Error).message, "\n");
  process.exitCode = 1;
});
