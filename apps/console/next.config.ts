import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // @ovation/core ships TypeScript source, not a build artifact.
  transpilePackages: ["@ovation/core"],
  // The Prisma client must not be bundled into the server build. Neon's driver
  // also pulls in `ws` with an optional native addon that webpack mangles
  // ("bufferUtil.mask is not a function"), so keep both out of the bundle.
  serverExternalPackages: [
    "@prisma/client",
    "prisma",
    "@prisma/adapter-neon",
    "@neondatabase/serverless",
  ],
};

export default config;
