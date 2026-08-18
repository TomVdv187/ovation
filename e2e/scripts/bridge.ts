/**
 * The far side of the e2e bridge. Runs under tsx, speaks newline-delimited
 * JSON on stdin/stdout, and exists for one reason: to import the modules
 * Playwright cannot.
 *
 * Playwright compiles a `.ts` file to CJS unless the nearest package.json says
 * `"type": "module"`. `apps/events` and `apps/live` are Next apps and say no
 * such thing, so anything under them is CJS inside the test runner — and the
 * moment one of those files imports a *runtime value* from `@ovation/core`
 * (an ESM package), the require hook has nothing to hand back:
 *
 *     Error: request for './schemas/index' is not in cache
 *
 * Type-only imports erase, which is why `ops.ts` and `announce.ts` were always
 * fine and `qr.ts` (which imports `qrTokenPayloadSchema`, a value) never was.
 *
 * Under tsx there is no boundary to cross — which is how `critic-door.ts` and
 * `critic-rush.ts` have been exercising these exact code paths all along. So
 * the bridge does not work around the product; it borrows the runtime the
 * product's own scripts already use.
 *
 * Every task below calls the real thing. Nothing is stubbed, nothing is
 * reimplemented — a task body is an import and a call, so there is no room for
 * this file to quietly become a second implementation that passes.
 */
import { createInterface } from "node:readline";
import { db } from "@ovation/core/db";
import {
  BRIDGE_REPLY,
  type BridgeReply,
  type BridgeRequest,
  type BridgeTask,
  type BridgeTasks,
} from "../helpers/bridge-tasks";

const tasks: {
  [K in BridgeTask]: (args: BridgeTasks[K]["args"]) => Promise<unknown>;
} = {
  async startCheckout(args) {
    const { startCheckout } = await import("@ovation/events/ticketing");
    return startCheckout(args);
  },
  async signQrToken(args) {
    const { signQrToken } = await import("../../apps/live/src/server/live/qr");
    return signQrToken(args);
  },
  async performCheckin(args) {
    const { performCheckin } = await import(
      "../../apps/live/src/server/live/checkin"
    );
    return performCheckin(db, args);
  },
  async opsSnapshot(args) {
    const { opsSnapshot } = await import("../../apps/live/src/server/live/ops");
    return opsSnapshot(db, args.eventId);
  },
};

function reply(message: BridgeReply) {
  process.stdout.write(`${BRIDGE_REPLY}${JSON.stringify(message)}\n`);
}

async function handle(line: string) {
  let request: BridgeRequest;
  try {
    request = JSON.parse(line) as BridgeRequest;
  } catch {
    return; // Not for us. Anything on stdin that is not JSON is ignored.
  }

  const handler = tasks[request.task] as
    | ((args: unknown) => Promise<unknown>)
    | undefined;
  if (!handler) {
    reply({ id: request.id, ok: false, error: `unknown task ${request.task}` });
    return;
  }

  try {
    reply({ id: request.id, ok: true, value: await handler(request.args) });
  } catch (e) {
    // The stack matters: a failure in here is a failure in the product code
    // the task called, and the spec should be able to read it as one.
    reply({
      id: request.id,
      ok: false,
      error: e instanceof Error ? (e.stack ?? e.message) : String(e),
    });
  }
}

const queue = createInterface({ input: process.stdin });
let chain = Promise.resolve();
queue.on("line", (line) => {
  // Serialised on purpose. The spec awaits each call, and a shared db pool in
  // a throwaway process is not worth the concurrency.
  chain = chain.then(() => handle(line));
});
queue.on("close", () => {
  void chain.then(() => db.$disconnect()).then(() => process.exit(0));
});

process.stdout.write(`${BRIDGE_REPLY}ready\n`);
