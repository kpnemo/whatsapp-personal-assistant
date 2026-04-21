import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "test-utils",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // testcontainers-backed tests can be slow on first pull
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: { reporter: ["text", "lcov"], include: ["src/**"] },
  },
});
