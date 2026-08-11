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
  // Neon's driver pulls in `ws` with an optional native addon that webpack
  // mangles ("bufferUtil.mask is not a function"). Keep it out of the bundle.
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
