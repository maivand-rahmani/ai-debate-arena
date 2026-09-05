import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  // monorepo: eslint-config-next's ".next/**" ignore is config-dir-relative,
  // so also ignore the app's nested build dir explicitly
  { ignores: ["**/.next/**"] },
  ...nextVitals,
  ...nextTypescript,
];

export default config;
