import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    // testcontainers-backed tests can be slow on first image pull
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**"],
      // server.ts is a process entrypoint (listen + signal handlers) — not
      // covered by unit tests and out of scope per the QA1 plan.
      exclude: ["src/server.ts", "**/*.test.ts"],
      // Current floor (~82/83/97/82 with service.test.ts). We deliberately
      // leave the register-route happy paths untested at this tier (covered by
      // the e2e smoke test); tighten once those graduate to unit tests.
      thresholds: {
        statements: 78,
        branches: 78,
        functions: 94,
        lines: 78,
      },
    },
  },
});
