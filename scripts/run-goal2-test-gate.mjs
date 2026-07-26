import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const gateDefinitions = Object.freeze({
  "runtime-deployment": ["packages/runtime-deployment/test", "tests/runtime-deployment"],
  "db-provisioner": [
    "packages/postgres-provisioner/test",
    "packages/runtime-migration-runner/test",
    "packages/secret-store/test",
    "tests/db-provisioner",
  ],
  "pm2-adapter": ["packages/pm2-runtime-adapter/test", "tests/pm2-adapter"],
  registry: ["packages/registry-snapshot/test", "tests/registry"],
  "platform-e2e": ["tests/platform-e2e"],
});

const isTestFile = (path) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);

function collectTests(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) return [];

  const tests = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      tests.push(...collectTests(child));
    } else if (entry.isFile() && isTestFile(child)) {
      tests.push(child);
    }
  }
  return tests;
}

const gate = process.argv[2];
const roots = gateDefinitions[gate];

if (!roots) {
  console.error(
    `UNKNOWN_GOAL2_TEST_GATE: ${gate ?? "<missing>"}; expected one of ${Object.keys(gateDefinitions).join(", ")}`,
  );
  process.exit(2);
}

const tests = [...new Set(roots.flatMap(collectTests))].sort();
if (tests.length === 0) {
  console.error(
    `GOAL2_TEST_GATE_NOT_IMPLEMENTED: ${gate}; no test files found under ${roots.join(", ")}`,
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...tests], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`GOAL2_TEST_GATE_EXECUTION_FAILED: ${gate}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
