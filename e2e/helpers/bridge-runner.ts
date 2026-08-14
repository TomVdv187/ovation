/**
 * The tsx side of the module bridge. Owned by Agent 11 · HARNESS.
 *
 * WHY THIS EXISTS. Golden-path tests 4 and 5 have to run product code that
 * imports ESM-only packages — `jose` (apps/live's QR signing) and
 * `@anthropic-ai/sdk` (pulled in transitively by @ovation/revenue). Playwright
 * transpiles every spec, and every module it `import()`s, to CommonJS through
 * its own require hook. That hook cannot load a package that ships only ESM, so
 * the imports die before a single assertion runs:
 *
 *   Cannot read properties of undefined (reading 'exports')
 *   './schemas/index' is not in cache
 *
 * The very same code paths load and run fine under tsx — that is exactly what
 * apps/events/scripts/critic-rush.ts and apps/live/scripts/critic-door.ts do.
 * So instead of fighting Playwright's transform, the spec spawns this file
 * under tsx (via `node --import tsx`, the same node running the test), which
 * does the ESM imports natively and hands back plain JSON.
 *
 * This file does the module work ONLY. It computes nothing the spec then
 * trusts on faith: it returns raw before/after numbers and per-item outcomes,
 * and every `expect` stays in golden-path.spec.ts. Nothing here is stubbed —
 * the QR token is signed with the real `signQrToken`/`qrSecret`, the checkout
 * is the real `startCheckout`, the revenue figure is the real tRPC caller.
 *
 * Protocol: argv[2] is a JSON command `{ kind, ... }`. On success it prints
 * one line `BRIDGE_RESULT:<json>` to stdout; on failure it prints
 * `BRIDGE_ERROR:<json>` and exits 1. All other output (tsx notices, logs) is
 * ignored by the parent, which reads only the sentinel line.
 */
import { db } from "@ovation/core/db";

const SENTINEL_OK = "BRIDGE_RESULT:";
const SENTINEL_ERR = "BRIDGE_ERROR:";

interface Session {
  user: {
    id: string;
    email: string;
    name: string | null;
    organisationId: string;
    role: "OWNER";
  };
}

type Command =
  | { kind: "revenueSummary"; eventId: string; session: Session }
  | {
      kind: "startCheckout";
      slug: string;
      tierId: string;
      quantity: number;
      email: string;
      name: string;
    }
  | { kind: "checkinBatch"; eventId: string; gids: string[]; tag: string };

async function revenueSummary(cmd: {
  eventId: string;
  session: Session;
}): Promise<unknown> {
  const { revenueRouter } = await import("@ovation/revenue");
  const { createCallerFactory, router } = await import("@ovation/core");
  const caller = createCallerFactory(router({ revenue: revenueRouter }))({
    db,
    session: cmd.session,
    headers: null,
  });
  return caller.revenue.summary({ eventId: cmd.eventId });
}

async function startCheckout(cmd: {
  slug: string;
  tierId: string;
  quantity: number;
  email: string;
  name: string;
}): Promise<unknown> {
  const { startCheckout: run } = await import("@ovation/events/ticketing");
  return run({
    slug: cmd.slug,
    tierId: cmd.tierId,
    quantity: cmd.quantity,
    email: cmd.email,
    name: cmd.name,
  });
}

/**
 * Signs a real QR token per guest, checks each in, and snapshots ops before
 * and after. The signing is the real one — the whole point of test 5 is that a
 * check-in exercises the signature, so a stub here would test nothing.
 */
async function checkinBatch(cmd: {
  eventId: string;
  gids: string[];
  tag: string;
}): Promise<unknown> {
  const { signQrToken } = await import("../../apps/live/src/server/live/qr");
  const { performCheckin } = await import(
    "../../apps/live/src/server/live/checkin"
  );
  const { opsSnapshot } = await import("../../apps/live/src/server/live/ops");

  const before = await opsSnapshot(db, cmd.eventId);
  const outcomes: string[] = [];
  for (const gid of cmd.gids) {
    const token = await signQrToken({ gid, eid: cmd.eventId });
    const res = await performCheckin(db, {
      eventId: cmd.eventId,
      token,
      lane: "main",
      idempotencyKey: `${cmd.tag}-${gid}`,
      offlineSynced: false,
    });
    outcomes.push(res.outcome);
  }
  const after = await opsSnapshot(db, cmd.eventId);
  return { before, after, outcomes };
}

async function dispatch(cmd: Command): Promise<unknown> {
  switch (cmd.kind) {
    case "revenueSummary":
      return revenueSummary(cmd);
    case "startCheckout":
      return startCheckout(cmd);
    case "checkinBatch":
      return checkinBatch(cmd);
    default: {
      const exhaustive: never = cmd;
      throw new Error(`Unknown bridge command: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Writes a line and resolves only once it has flushed to the OS pipe. */
function emit(line: string): Promise<void> {
  return new Promise((resolve) => process.stdout.write(line, () => resolve()));
}

async function finish(code: number): Promise<never> {
  const disconnect = (db as { $disconnect?: () => Promise<unknown> }).$disconnect;
  if (disconnect) await disconnect.call(db).catch(() => {});
  process.exit(code);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error("bridge-runner: missing command argument");
  const cmd = JSON.parse(arg) as Command;
  const data = await dispatch(cmd);
  // Flush the result BEFORE exiting — process.exit can truncate a pending
  // write to a pipe, which would drop the sentinel line the parent reads.
  await emit(`${SENTINEL_OK}${JSON.stringify(data)}\n`);
}

main()
  .then(() => finish(0))
  .catch(async (err: unknown) => {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    await emit(`${SENTINEL_ERR}${JSON.stringify({ message })}\n`);
    await finish(1);
  });
