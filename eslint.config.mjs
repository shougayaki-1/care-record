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
  {
    // These auth and organization transitions intentionally reload the document
    // so client state and session cookies are rebuilt together.
    files: [
      "src/app/app/profile/page.tsx",
      "src/app/app/settings/page.tsx",
      "src/app/setup/page.tsx",
      "src/context/WorkspaceContext.tsx",
    ],
    rules: {
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    ".claude/**",
    "next-env.d.ts",
    "public/sw.js",
    "public/workbox-*.js",
    "ai_context_output/**",
    "collect_code.js",
    "storybook-static/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
