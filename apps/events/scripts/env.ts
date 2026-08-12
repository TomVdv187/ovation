import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads the repo-root .env for the verification scripts.
 *
 * Next.js reads .env from the app directory and this monorepo keeps a single
 * one at the root, which is why the package scripts go through dotenv-cli.
 * These scripts do it themselves so they run from a bare clone with nothing
 * installed globally. Existing environment variables always win.
 */
export function loadRootEnv(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

  let contents: string;
  try {
    contents = readFileSync(join(root, ".env"), "utf8");
  } catch {
    return; // Already exported, or genuinely absent. Let the caller complain.
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    if (process.env[key] !== undefined) continue;

    let value = (match[2] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
