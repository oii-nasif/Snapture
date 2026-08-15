import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@capture": path.resolve(__dirname, "src/capture"),
      "@content": path.resolve(__dirname, "src/content"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
  },
});
