import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", passWithNoTests: true },
  // Mirror tsconfig `paths` (`@/*` -> `src/*`) so unit tests can import
  // production modules that use the `@/` alias.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
