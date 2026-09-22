import { dirname } from "path";
import { fileURLToPath } from "url";

import { FlatCompat } from "@eslint/eslintrc";
import prettier from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // The brief forbids `any` outright, so escalate from the preset's warning.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      // `_`-prefixed bindings are intentionally discarded (e.g. omitting a key
      // via destructuring), which is the conventional signal for that.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Must come last: switches off stylistic rules Prettier owns.
  prettier,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
];

export default eslintConfig;
