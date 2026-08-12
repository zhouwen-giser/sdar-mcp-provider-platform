import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15_000,
    hookTimeout: 15_000,
    restoreMocks: true,
    clearMocks: true,
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    exclude: [...configDefaults.exclude, "tests/e2e/pms-console-real/**"],
  },
});
