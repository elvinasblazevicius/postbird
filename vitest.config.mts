import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@site-config": path.resolve(__dirname, "site.config.ts"), "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The integration test files share one throwaway database and empty its tables, so they must not run at the same time.
    fileParallelism: false,
  },
});
