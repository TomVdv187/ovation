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

  // Prisma and Neon's driver must stay out of the bundle: Prisma resolves its
  // query engine relative to its own directory, and Neon pulls in `ws` with an
  // optional native addon that webpack mangles ("bufferUtil.mask is not a
  // function"). All four entries are load-bearing — dropping the two Neon ones
  // gives a build that succeeds and then 500s on the first query.
  //
  // Because they are external, Next has to TRACE them into the lambda, which is
  // why this app declares @prisma/client as a direct dependency even though it
  // only ever imports @ovation/core/db. Without that declaration pnpm creates no
  // symlink under apps/live/node_modules and the engine never ships.
  serverExternalPackages: [
    "@prisma/client",
    "prisma",
    "@prisma/adapter-neon",
    "@neondatabase/serverless",
  ],

  // Without this Next walks past the workspace looking for a lockfile and can
  // settle on one outside the repo, which makes the traced file set wrong.
  outputFileTracingRoot: workspaceRoot,
};

export default config;
