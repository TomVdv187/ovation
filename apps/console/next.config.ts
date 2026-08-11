import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // @ovation/core ships TypeScript source, not a build artifact.
  transpilePackages: ["@ovation/core"],
  // The Prisma client must not be bundled into the server build.
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default config;
