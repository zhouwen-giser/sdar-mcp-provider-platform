import { defineConfig } from "vitest/config";
export default defineConfig({
  root: new URL("../../", import.meta.url).pathname,
  test: {
    setupFiles: ["apps/ugv-control-console/test/setup.ts"],
    include: ["apps/ugv-control-console/test/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
