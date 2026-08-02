import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const scripts = [
  "check-contract-lock.mjs",
  "check-route-inventory.mjs",
  "check-protected-paths.mjs",
];
let passed = true;
for (const script of scripts) {
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, script)], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  process.stdout.write(`=== ${script} ===\n${result.stdout}`);
  if (result.status !== 0) {
    passed = false;
    process.stderr.write(result.stderr);
  }
}
process.stdout.write(`PMS_CONSOLE_CONFORMANCE_STATIC=${passed ? "PASSED" : "FAILED"}\n`);
if (!passed) process.exitCode = 1;
