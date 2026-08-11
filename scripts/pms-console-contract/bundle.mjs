/* global console, process */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contract } from "./lib.mjs";

const input = path.join(contract, "openapi.yaml");
const config = path.join(contract, "redocly.yaml");
const windows = process.platform === "win32";
const executable = path.join(
  process.cwd(),
  `node_modules/.bin/${windows ? "redocly.cmd" : "redocly"}`,
);
const outputs = [
  [path.join(contract, "dist/openapi.bundle.json"), "json", false],
  [path.join(contract, "dist/openapi.bundle.yaml"), "yaml", false],
  [path.join(contract, "dist/openapi.resolved.yaml"), "yaml", true],
];

fs.mkdirSync(path.join(contract, "dist"), { recursive: true });
for (const [output, extension, dereferenced] of outputs) {
  const result = spawnSync(
    executable,
    [
      "bundle",
      input,
      ...(dereferenced ? ["--dereferenced"] : []),
      "--output",
      output,
      "--ext",
      extension,
      "--config",
      config,
    ],
    { stdio: "inherit", shell: windows },
  );
  if (result.error !== undefined) console.error(result.error);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const packageSchema = path.join(
  process.cwd(),
  "packages/pms-console-api-contract/schema/openapi.bundle.json",
);
fs.mkdirSync(path.dirname(packageSchema), { recursive: true });
fs.copyFileSync(outputs[0][0], packageSchema);
console.log("deterministic Redocly bundles generated");
