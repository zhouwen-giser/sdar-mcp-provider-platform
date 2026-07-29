import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const testFile = "tests/worker-lease-safety/run-worker-lease-safety.mjs";
if (!existsSync(testFile)) {
  process.stderr.write(`WORKER_LEASE_SAFETY_ARTIFACT_MISSING: ${testFile}\n`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", testFile], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  timeout: 120_000,
});

if (result.error) {
  process.stderr.write(`WORKER_LEASE_SAFETY_GATE_EXECUTION_FAILED: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
