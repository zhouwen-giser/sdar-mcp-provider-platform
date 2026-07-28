import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const testFile = "apps/pms-api/test/production-composition.test.ts";

if (!existsSync(testFile)) {
  process.stderr.write(`PMS_API_PRODUCTION_TEST_MISSING: ${testFile}\n`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", testFile], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write(`PMS_API_PRODUCTION_GATE_EXECUTION_FAILED: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
