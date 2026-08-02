/* global console, process */
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { contract } from "./lib.mjs";

const executable = path.join(process.cwd(), "node_modules/.bin/openapi-typescript");
const input = path.join(contract, "openapi.yaml");
const output = path.join(process.cwd(), "packages/pms-console-api-contract/src/dto.d.ts");
const args = [
  input,
  "--output",
  output,
  "--immutable",
  "--alphabetize",
  "--root-types",
  "--root-types-no-schema-prefix",
];
const result = spawnSync(executable, args, { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
const generated = fs.readFileSync(output, "utf8");
fs.writeFileSync(
  output,
  `/* eslint-disable @typescript-eslint/consistent-indexed-object-style */\n${generated}`,
);
console.log("TypeScript types generated with openapi-typescript");
