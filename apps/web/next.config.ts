import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@arena/ai", "@arena/debate-engine", "@arena/types"],
};

export default nextConfig;
