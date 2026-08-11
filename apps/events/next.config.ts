import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ovation/core"],
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default config;
