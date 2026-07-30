/* global console, process */
import { spawnSync } from "node:child_process";

const freeze = process.argv.includes("--freeze");
const approvedExceptions = process.argv.includes("--approved-non-contract-exceptions");
const commands = [
  ["node", ["scripts/pms-console-contract/generate-artifacts.mjs"]],
  ["node", ["scripts/pms-console-contract/lint.mjs"]],
  ["node", ["scripts/pms-console-contract/check-semantics.mjs"]],
  ["node", ["scripts/pms-console-contract/check-enums.mjs"]],
  [
    "node",
    ["scripts/pms-console-contract/check-sources.mjs", ...(freeze ? ["--require-local"] : [])],
  ],
  [
    "node",
    ["scripts/pms-console-contract/check-errors.mjs", ...(freeze ? ["--require-local"] : [])],
  ],
  ["node", ["scripts/pms-console-contract/check-objects.mjs"]],
  ["node", ["scripts/pms-console-contract/check-examples.mjs"]],
  ["node", ["scripts/pms-console-contract/check-schemas.mjs"]],
  ["node", ["scripts/pms-console-contract/validate-examples.mjs"]],
  ["node", ["scripts/pms-console-contract/check-breaking.mjs"]],
  ["node", ["scripts/pms-console-contract/check-generated.mjs"]],
  ...(approvedExceptions
    ? [["node", ["scripts/pms-console-contract/check-freeze-exceptions.mjs"]]]
    : []),
  [
    "node",
    [
      "scripts/pms-console-contract/check-scope.mjs",
      ...(approvedExceptions ? ["--approved-non-contract-exceptions"] : []),
    ],
  ],
  [
    "node",
    [
      "scripts/pms-console-contract/check-business-impact.mjs",
      ...(freeze ? ["--require-complete"] : []),
    ],
  ],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  freeze
    ? approvedExceptions
      ? "all protocol freeze prerequisites passed with explicit non-contract exceptions"
      : "all freeze prerequisites passed"
    : "all candidate gates passed",
);
