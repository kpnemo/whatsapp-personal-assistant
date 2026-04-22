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
    coverage: { reporter: ["text", "lcov"], include: ["src/**"] },
  },
});
