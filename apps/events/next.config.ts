import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { loadRootEnv } from "./scripts/env";

const here = path.dirname(fileURLToPath(import.meta.url));

// Next only looks for .env beside the app; this monorepo keeps one at the root.
// Reading it here means `next dev` works from a bare clone without a global
// dotenv-cli. Anything already exported wins, so a real deployment is untouched.
loadRootEnv();

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ovation/core"],

  // Prisma and Neon's driver must stay out of the bundle: Prisma resolves its
  // query engine relative to its own directory, and Neon pulls in `ws` with an
  // optional native addon that webpack mangles ("bufferUtil.mask is not a
  // function").
  //
  // Because they are external, Next has to TRACE them into the lambda, which is
  // why this app declares @prisma/client as a direct dependency even though it
  // only ever imports @ovation/core/db. Without that declaration pnpm creates no
  // symlink under apps/events/node_modules, tracing cannot resolve the package,
  // and the deploy ships without libquery_engine-*.so.node — a build that
  // succeeds and then 500s on the first query.
  serverExternalPackages: [
    "@prisma/client",
    "prisma",
    "@prisma/adapter-neon",
    "@neondatabase/serverless",
  ],

  // Without this, Next walks up past the repo looking for a workspace root,
  // finds a stray lockfile in the home directory and tries to trace the whole
  // of it. The monorepo root is two levels up and nowhere else.
  outputFileTracingRoot: path.join(here, "../../"),
};

export default config;
