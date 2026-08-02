/* global console, process */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const gates = [
  ["pnpm install --frozen-lockfile", "pnpm", ["install", "--frozen-lockfile"]],
  ["pnpm pms-console-contract:generate", "pnpm", ["pms-console-contract:generate"]],
  ["pnpm pms-console-contract:lint", "pnpm", ["pms-console-contract:lint"]],
  ["pnpm pms-console-contract:bundle", "pnpm", ["pms-console-contract:bundle"]],
  ["pnpm pms-console-contract:test", "pnpm", ["pms-console-contract:test"]],
  ["pnpm pms-console-contract:check-sources", "pnpm", ["pms-console-contract:check-sources"]],
  ["pnpm pms-console-contract:check-errors", "pnpm", ["pms-console-contract:check-errors"]],
  [
    "pnpm pms-console-contract:check-business-impact",
    "pnpm",
    ["pms-console-contract:check-business-impact"],
  ],
  ["pnpm pms-console-contract:check-breaking", "pnpm", ["pms-console-contract:check-breaking"]],
  ["pnpm typecheck", "pnpm", ["typecheck"]],
  ["pnpm lint", "pnpm", ["lint"]],
  ["pnpm format:check", "pnpm", ["format:check"]],
  ["pnpm build", "pnpm", ["build"]],
  ["git diff --check", "git", ["diff", "--check"]],
];

const results = [];
for (const [command, executable, args] of gates) {
  const startedAt = new Date().toISOString();
  console.log(`repository gate start: ${command}`);
  const result = spawnSync(executable, args, { stdio: "inherit" });
  const exitCode = result.status ?? 1;
  results.push({
    command,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    status: exitCode === 0 ? "passed" : "failed",
  });
  console.log(`repository gate exit ${exitCode}: ${command}`);
}

const output = path.join(
  process.cwd(),
  "reports/pms-console-api-contract-v1/REPOSITORY_GATE_EVIDENCE.json",
);
fs.writeFileSync(
  output,
  `${JSON.stringify(
    {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      allPassed: results.every((result) => result.exitCode === 0),
      results,
    },
    null,
    2,
  )}\n`,
);
if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1;
