/* global console, process */
import path from "node:path";
import { spawnSync } from "node:child_process";

const commands = [
  ["node", ["scripts/pms-console-contract/bundle.mjs"]],
  ["node", ["scripts/pms-console-contract/generate-schemas.mjs"]],
  ["node", ["scripts/pms-console-contract/generate-types.mjs"]],
  [
    path.join(process.cwd(), "node_modules/.bin/prettier"),
    [
      "--write",
      "contracts/pms-console-api/v1/dist",
      "contracts/pms-console-api/v1/schemas",
      "packages/pms-console-api-contract/schema/openapi.bundle.json",
      "packages/pms-console-api-contract/src/dto.d.ts",
    ],
  ],
];
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("generated artifacts complete");
