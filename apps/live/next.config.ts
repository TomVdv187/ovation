import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const workspaceRoot = path.join(import.meta.dirname, "../../");

/**
 * Next loads `.env` from the *app* directory, but OVATION keeps one `.env` at
 * the workspace root — which means `next dev` in this package would otherwise
 * start with no DATABASE_URL and, worse, no QR_SIGNING_SECRET. A door that
 * silently falls back to a development signing secret rejects every genuine
 * pass, so this is not a convenience.
 *
 * Anything already set on the command line wins; this only fills gaps.
 */
function loadWorkspaceEnv(): void {
  let raw: string;
  try {
    raw = readFileSync(path.join(workspaceRoot, ".env"), "utf8");
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

loadWorkspaceEnv();

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ovation/core"],
  serverExternalPackages: ["@prisma/client", "prisma"],
  // Without this Next walks past the workspace looking for a lockfile and can
  // settle on one outside the repo, which makes the traced file set wrong.
  outputFileTracingRoot: workspaceRoot,
};

export default config;
