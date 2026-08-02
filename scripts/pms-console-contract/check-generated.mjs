/* global console, process */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contract, hashFile } from "./lib.mjs";

function generatedFiles() {
  const roots = [
    path.join(contract, "dist"),
    path.join(contract, "schemas"),
    path.join(process.cwd(), "packages/pms-console-api-contract/src"),
    path.join(process.cwd(), "packages/pms-console-api-contract/schema"),
  ];
  function walk(directory) {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory()
          ? walk(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      );
  }
  return roots.flatMap(walk).sort();
}

function hashes() {
  return new Map(
    generatedFiles().map((file) => [path.relative(process.cwd(), file), hashFile(file)]),
  );
}

const before = hashes();
const result = spawnSync("node", ["scripts/pms-console-contract/generate-artifacts.mjs"], {
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
const after = hashes();
if (JSON.stringify([...before]) !== JSON.stringify([...after])) {
  throw new Error("generated artifacts were stale or nondeterministic");
}
console.log(`generated artifact freshness passed: ${after.size} files`);
