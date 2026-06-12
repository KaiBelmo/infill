import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@infill/snaplog/extension": path.resolve(__dirname, "../../packages/snaplog/src/extension.ts"),
      "@infill/snaplog": path.resolve(__dirname, "../../packages/snaplog/src/index.ts")
    }
  },
  test: {
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
