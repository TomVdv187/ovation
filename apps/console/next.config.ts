import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // @ovation/core ships TypeScript source, not a build artifact. So do the four
  // routers the console mounts in Phase 3 — two library packages and two
  // sibling Next apps whose routers were written to be host-agnostic.
  transpilePackages: [
    "@ovation/core",
    "@ovation/guests",
    "@ovation/revenue",
    "@ovation/events",
    "@ovation/live",
  ],

  // Prisma and Neon's driver must stay out of the bundle: Prisma resolves its
  // query engine relative to its own directory, and Neon pulls in `ws` with an
  // optional native addon that webpack mangles ("bufferUtil.mask is not a
  // function").
  //
  // Because they are external, Next has to TRACE them into the lambda, which is
  // why this app declares @prisma/client as a direct dependency even though it
  // only ever imports @ovation/core/db. Without that declaration pnpm creates no
  // symlink under apps/console/node_modules, tracing cannot resolve the package,
  // and the deploy ships without libquery_engine-*.so.node — a build that
  // succeeds and then 500s on the first query.
  serverExternalPackages: [
    "@prisma/client",
    "prisma",
    "@prisma/adapter-neon",
    "@neondatabase/serverless",
  ],

  // Monorepo: trace from the repo root so workspace files resolve.
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
};

export default config;
