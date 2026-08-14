/**
 * The Playwright side of the module bridge. Owned by Agent 11 · HARNESS.
 *
 * This runs under Playwright's own transform, so it must NOT import any of the
 * ESM-only product modules (that is the whole problem — see bridge-runner.ts).
 * It only spawns node with the tsx loader, hands the runner a JSON command, and
 * reads a JSON result back. Everything it touches is a Node built-in.
 *
 * Why `node --import tsx` and not the `tsx` binary: spawning the `.bin/tsx`
 * shim on Windows needs a shell, which drags in quoting bugs. `node --import
 * tsx` runs the exact same node that runs Playwright, resolves `tsx` from
 * @ovation/e2e's own node_modules (that is why tsx is a devDependency here),
 * and passes the command as a single argv element with no shell in between.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("./bridge-runner.ts", import.meta.url));
const E2E_ROOT = fileURLToPath(new URL("..", import.meta.url));

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

/** Runs one bridge command under tsx and returns its parsed JSON result. */
async function run<T>(command: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", RUNNER, JSON.stringify(command)],
      {
        // cwd is @ovation/e2e so `--import tsx` resolves tsx from its
        // node_modules; the runner's own relative imports resolve against the
        // runner file, not cwd, so they are unaffected.
        cwd: E2E_ROOT,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", reject);
    child.on("close", (code) => {
      const line = stdout
        .split(/\r?\n/)
        .find((l) => l.startsWith(SENTINEL_OK) || l.startsWith(SENTINEL_ERR));

      if (line?.startsWith(SENTINEL_OK)) {
        try {
          resolve(JSON.parse(line.slice(SENTINEL_OK.length)) as T);
        } catch (err) {
          reject(new Error(`bridge: unparseable result: ${String(err)}`));
        }
        return;
      }

      if (line?.startsWith(SENTINEL_ERR)) {
        const { message } = JSON.parse(line.slice(SENTINEL_ERR.length)) as {
          message: string;
        };
        reject(new Error(`bridge command '${command.kind}' failed:\n${message}`));
        return;
      }

      reject(
        new Error(
          `bridge command '${command.kind}' produced no result (exit ${code}).\n` +
            `stdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}

export interface RevenueSummary {
  tickets: { totalCents: number; sold: number };
  [key: string]: unknown;
}

export function revenueSummary(
  eventId: string,
  session: Session,
): Promise<RevenueSummary> {
  return run<RevenueSummary>({ kind: "revenueSummary", eventId, session });
}

export type CheckoutOutcome =
  | { ok: true; orderId: string; redirectTo: string }
  | { ok: false; formError?: string; errors?: unknown };

export function startCheckout(args: {
  slug: string;
  tierId: string;
  quantity: number;
  email: string;
  name: string;
}): Promise<CheckoutOutcome> {
  return run<CheckoutOutcome>({ kind: "startCheckout", ...args });
}

export interface CheckinBatchResult {
  before: { checkedIn: number; capacityPercent: number };
  after: { checkedIn: number; capacityPercent: number };
  outcomes: string[];
}

export function checkinBatch(args: {
  eventId: string;
  gids: string[];
  tag: string;
}): Promise<CheckinBatchResult> {
  return run<CheckinBatchResult>({ kind: "checkinBatch", ...args });
}
