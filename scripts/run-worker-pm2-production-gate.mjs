import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const testFile = "tests/worker-pm2-production/run-production-lifecycle.mjs";
const requiredArtifacts = [
  testFile,
  "dist/apps/runtime/src/main.js",
  "dist/examples/mock-adapter-typescript/src/main.js",
];

for (const artifact of requiredArtifacts) {
  if (!existsSync(artifact)) {
    process.stderr.write(`WORKER_PM2_PRODUCTION_ARTIFACT_MISSING: ${artifact}\n`);
    process.exit(1);
  }
}

const result = spawnSync(process.execPath, ["--import", "tsx", testFile], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  timeout: 420_000,
});

if (result.error) {
  process.stderr.write(`WORKER_PM2_PRODUCTION_GATE_EXECUTION_FAILED: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
