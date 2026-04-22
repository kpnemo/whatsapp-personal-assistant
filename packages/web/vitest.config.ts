import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**"],
      exclude: [
        // Entrypoint wiring (tested indirectly via e2e + component tests).
        "src/main.tsx",
        "src/App.tsx",
        // Unused shadcn primitives — scaffolded but not yet adopted by any
        // feature. They'll get tests when they're put into service; counting
        // them now unfairly drags the floor down.
        "src/components/ui/accordion.tsx",
        "src/components/ui/breadcrumb.tsx",
        "src/components/ui/checkbox.tsx",
        "src/components/ui/command.tsx",
        "src/components/ui/hover-card.tsx",
        "src/components/ui/navigation-menu.tsx",
        "src/components/ui/popover.tsx",
        "src/components/ui/progress.tsx",
        "src/components/ui/radio-group.tsx",
        "src/components/ui/scroll-area.tsx",
        "src/components/ui/separator.tsx",
        "src/components/ui/sheet.tsx",
        "src/components/ui/slider.tsx",
        "src/components/ui/switch.tsx",
        "src/components/ui/tabs.tsx",
        "src/components/ui/textarea.tsx",
        // Test helpers + generated types.
        "src/test/**",
        "src/vite-env.d.ts",
        "**/*.test.{ts,tsx}",
      ],
      thresholds: {
        statements: 75,
        branches: 80,
        functions: 75,
        lines: 75,
      },
    },
  },
});
