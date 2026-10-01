import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Two projects: the pure lib + main-process tests run under node, the renderer
// (React) tests run under jsdom with Testing Library. Coverage is merged; the
// lib layer stays gated at 100%, the renderer at the reached line coverage.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        plugins: [react()],
        test: {
          name: "ui",
          include: ["tests/ui/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["tests/ui/setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/main/**/*.ts", "src/preload/**/*.ts", "src/renderer/src/**/*.{ts,tsx}"],
      // Entry file only mounts <App/> into #root — nothing to test in isolation.
      exclude: ["src/renderer/src/main.tsx", "src/preload/api.d.ts", "src/renderer/src/env.d.ts"],
      reporter: ["text", "html"],
      thresholds: {
        "src/lib/**": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Renderer line coverage has held at 100% over repeated runs; gate two points below.
        "src/renderer/**": {
          lines: 98,
        },
      },
    },
  },
});
