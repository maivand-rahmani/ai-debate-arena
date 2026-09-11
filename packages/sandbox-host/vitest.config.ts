import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The Windows integration tests spawn and terminate real child processes
    // under a Job Object; keep a generous but bounded per-test budget so a
    // regression can never hang the suite indefinitely.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Files manage real processes and shared temp dirs — run them strictly
    // one at a time so cleanup assertions can never race each other.
    fileParallelism: false,
  },
});
