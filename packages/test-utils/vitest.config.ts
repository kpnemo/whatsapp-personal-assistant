import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "test-utils",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // testcontainers-backed tests can be slow on first pull
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**"],
      // index.ts (pure re-exports) is 0% — v8's statement counter flags the
      // export line itself. Excluded so it doesn't pull the floor down.
      exclude: ["src/index.ts", "**/*.test.ts"],
      // Current floor (95/65/92/95 — see QA1 coverage report). Branches sit
      // low because of defensive error paths in makeTestRedis; tighten later.
      thresholds: {
        statements: 93,
        branches: 63,
        functions: 90,
        lines: 93,
      },
    },
  },
});
