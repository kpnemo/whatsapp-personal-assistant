import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "shared",
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**"],
      // index.ts is a pure re-export barrel; v8 counts the three `export *`
      // lines but tests import submodules directly, so they always read 0%.
      exclude: ["src/index.ts", "**/*.test.ts"],
      // Current floor (94/90/93/94 — see QA1 coverage report). Tight-but-not-ceiling.
      thresholds: {
        statements: 92,
        branches: 85,
        functions: 90,
        lines: 92,
      },
    },
  },
});
