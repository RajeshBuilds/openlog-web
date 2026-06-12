import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated code:
    "lib/generated/**",
    // Vendored from PostHog (MIT, see THIRD_PARTY_NOTICES.md) — kept
    // verbatim, not held to our lint rules:
    "lib/replay/transformer/**",
    "lib/replay/snapshotProcessing/**",
    "lib/replay/telemetry.ts",
    "lib/replay/types.ts",
    "lib/replay/utils.ts",
  ]),
]);

export default eslintConfig;
