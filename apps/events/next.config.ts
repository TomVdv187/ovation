import type { NextConfig } from "next";

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
};

export default config;
