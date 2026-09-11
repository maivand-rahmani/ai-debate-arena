import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@arena/ai", "@arena/debate-engine", "@arena/types"],
   allowedDevOrigins: ['local-origin.dev', '*.local-origin.dev'],
};

export default nextConfig;
