import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@mui/material",
          message: "Import through @/components/ui/mui, or use a semantic component from @/components/ui.",
        }, {
          name: "@/components/ui/mui",
          importNames: ["Dialog", "DialogTitle", "DialogContent", "DialogActions"],
          message: "Use AppDialog from @/components/ui for consistent dialog behavior.",
        }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/sw.js",
    "public/workbox-*.js",
    "ai_context_output/**",
    "collect_code.js",
    "storybook-static/**",
  ]),
]);

export default eslintConfig;
