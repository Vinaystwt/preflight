import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["web/**", "frontend*/**", "node_modules/**", "dist/**", "archive/**"]
  }
});
