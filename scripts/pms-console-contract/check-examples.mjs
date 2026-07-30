/* global console */
import fs from "node:fs";
import path from "node:path";
import { contract, operations, readJson } from "./lib.mjs";

const doc = readJson(path.join(contract, "openapi.yaml"));
const mapping = readJson(path.join(contract, "OPERATION_EXAMPLE_MAP.json"));
const ids = new Set(operations(doc).map((entry) => entry.operationId));
for (const id of ids) {
  if (!(id in mapping)) throw new Error(`missing example map ${id}`);
  if (!Array.isArray(mapping[id]) || mapping[id].length === 0) {
    throw new Error(`operation has no mapped example ${id}`);
  }
  for (const file of mapping[id]) {
    if (!fs.existsSync(path.join(contract, "examples", file))) {
      throw new Error(`missing example file ${id}:${file}`);
    }
  }
}
for (const id of Object.keys(mapping)) {
  if (!ids.has(id)) throw new Error(`orphan example map ${id}`);
}
console.log(`operation examples mapped: ${ids.size}`);
