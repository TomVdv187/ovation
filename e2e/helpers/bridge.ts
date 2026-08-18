import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  BRIDGE_REPLY,
  type BridgeReply,
  type BridgeTask,
  type BridgeTasks,
} from "./bridge-tasks";

/**
 * The near side of the bridge: spawn `scripts/bridge.ts` under tsx and talk to
 * it. See that file for why it exists.
 *
 * Nothing in here touches the workspace, so Playwright can transform it
 * however it likes.
 */

export interface Bridge {
  call<K extends BridgeTask>(
    task: K,
    args: BridgeTasks[K]["args"],
  ): Promise<BridgeTasks[K]["result"]>;
  close(): Promise<void>;
}

const SCRIPT = fileURLToPath(new URL("../scripts/bridge.ts", import.meta.url));
const CWD = fileURLToPath(new URL("..", import.meta.url));
const STARTUP_TIMEOUT = 60_000;

export async function openBridge(): Promise<Bridge> {
  const child: ChildProcess = spawn(
    process.execPath,
    ["--import", "tsx", SCRIPT],
    { cwd: CWD, stdio: ["pipe", "pipe", "pipe"], env: process.env },
  );

  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  let nextId = 1;
  let ready: (() => void) | null = null;
  let died: Error | null = null;

  // Kept so a startup failure can be reported with the reason attached rather
  // than as a bare timeout.
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const readyPromise = new Promise<void>((resolve, reject) => {
    ready = resolve;
    setTimeout(
      () => reject(new Error(`bridge did not start in ${STARTUP_TIMEOUT}ms\n${stderr}`)),
      STARTUP_TIMEOUT,
    ).unref();
  });

  createInterface({ input: child.stdout! }).on("line", (line) => {
    if (!line.startsWith(BRIDGE_REPLY)) {
      // The child is allowed to log. Pass it through so a Prisma or Neon
      // warning raised on the far side is still visible in the test output.
      if (line.trim()) console.log(`[bridge] ${line}`);
      return;
    }
    const body = line.slice(BRIDGE_REPLY.length);
    if (body === "ready") {
      ready?.();
      return;
    }
    const message = JSON.parse(body) as BridgeReply;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.ok) waiter.resolve(message.value);
    else waiter.reject(new Error(message.error));
  });

  const fail = (reason: string) => {
    died ??= new Error(`${reason}\n${stderr}`);
    for (const [id, waiter] of pending) {
      pending.delete(id);
      waiter.reject(died);
    }
  };
  child.on("error", (e) => fail(`bridge failed to spawn: ${e.message}`));
  child.on("exit", (code) => {
    if (pending.size > 0) fail(`bridge exited with code ${code}`);
  });

  await readyPromise;

  return {
    call(task, args) {
      if (died) return Promise.reject(died);
      const id = nextId++;
      const waiting = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      child.stdin!.write(`${JSON.stringify({ id, task, args })}\n`);
      // The cast is the one place the wire is untyped; BridgeTasks is what
      // keeps both ends honest about what crosses it.
      return waiting as Promise<BridgeTasks[typeof task]["result"]>;
    },
    close() {
      return new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.stdin!.end();
      });
    },
  };
}
