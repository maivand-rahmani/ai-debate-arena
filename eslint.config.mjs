import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  // monorepo: eslint-config-next's ".next/**" ignore is config-dir-relative,
  // so also ignore the app's nested build dir explicitly
  { ignores: ["**/.next/**"] },
  ...nextVitals,
  ...nextTypescript,
  { files: ["apps/web/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [
      { group: ["@arena/*/src/*", "@arena/*/src"], message: "Use the public entry point of @arena packages." },
      { group: ["../../packages/*", "../packages/*", "../../../packages/*"], message: "No relative imports into packages; use @arena/* barrels." } ] }] } },
  { files: ["packages/debate-engine/**/*.{ts,tsx}", "packages/types/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { paths: [
      { name: "server-only", message: "packages must not carry Next deploy markers." } ],
      patterns: [ { group: ["react", "react-dom", "react/*", "next", "next/*", "three", "@react-three/*", "@ai-sdk/*", "ai", "node:fs", "node:path", "node:os", "@arena/ai"], message: "Forbidden in this pure package (node:crypto is the only approved node builtin)." } ] }] } },
];

export default config;
