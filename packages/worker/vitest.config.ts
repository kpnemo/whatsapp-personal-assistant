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
    coverage: { reporter: ["text", "lcov"], include: ["src/**"] },
  },
});
