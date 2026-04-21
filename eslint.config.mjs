import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.generated.*",
      "**/generated/**",
      "packages/web/dist/**",
      "website/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [...tseslint.configs.recommendedTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "vitest.workspace.ts",
            "packages/shared/vitest.config.ts",
            "packages/api/vitest.config.ts",
            "packages/test-utils/vitest.config.ts",
          ],
          defaultProject: "tsconfig.base.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    plugins: { import: importPlugin },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
    settings: {
      "import/resolver": {
        typescript: { alwaysTryTypes: true, project: ["packages/*/tsconfig.json"] },
      },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  prettier,
);
