import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test-d.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      exclude: ["**/*.test.ts", "**/*.test-d.ts", "**/dist/**", "**/node_modules/**"],
      thresholds: { lines: 90 },
    },
  },
});
