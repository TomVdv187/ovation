import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.join(__dirname, "..", "..");

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ovation/core"],

  // Neon's driver pulls in `ws` with an optional native addon that webpack
  // mangles ("bufferUtil.mask is not a function"). Keep it out of the bundle.
  serverExternalPackages: [
    "@prisma/client",
    "prisma",
    "@prisma/adapter-neon",
    "@neondatabase/serverless",
  ],

  // pnpm hoists the Prisma client into a hashed .pnpm path that Next's file
  // tracing does not follow, so the serverless bundle ships without
  // libquery_engine-*.so.node and every query dies with
  // "Could not locate the Query Engine". Trace from the repo root and copy the
  // engine in explicitly.
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    "/**/*": [
      "node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/**/*",
    ],
  },
};

export default config;
