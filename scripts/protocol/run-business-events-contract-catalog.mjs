import { spawnSync } from "node:child_process";
import process from "node:process";

const result = spawnSync("pnpm", ["exec", "vitest", "run", "tests/business-events/contract"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
