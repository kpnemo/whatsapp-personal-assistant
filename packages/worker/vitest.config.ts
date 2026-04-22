import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "worker",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // testcontainers-backed auth-store / snapshot / restore tests need more
    // room than the default 5s, especially on first image pull.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**"],
      exclude: [
        // Process entrypoint + env parsing — covered indirectly via e2e. The
        // pair state machine / authStore / snapshotter / restore are tested
        // thoroughly in src/pair/*.test.ts.
        "src/index.ts",
        "src/env.ts",
        "**/*.test.ts",
      ],
      thresholds: {
        statements: 82,
        branches: 75,
        functions: 88,
        lines: 82,
      },
    },
  },
});
