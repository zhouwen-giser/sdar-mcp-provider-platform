/* global console, process */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contract, operations, readJson } from "./lib.mjs";

const requireLocal = process.argv.includes("--require-local");
const doc = readJson(path.join(contract, "openapi.yaml"));
const endpointMaps = readJson(path.join(contract, "ENDPOINT_SOURCE_MAP.json"));
const schemaMaps = readJson(path.join(contract, "SCHEMA_SOURCE_MAP.json"));
const byId = new Map(endpointMaps.map((entry) => [entry.operationId, entry]));

function blob(file) {
  const result = spawnSync("git", ["hash-object", file], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function meaningfulTokens(symbol) {
  return symbol
    .replace(/\([^)]*\)/g, "")
    .split(/[^A-Za-z0-9_]+/)
    .filter((token) => token.length > 3 && !["readonly", "response", "projection"].includes(token));
}

for (const operation of operations(doc)) {
  const mapping = byId.get(operation.operationId);
  if (!mapping) throw new Error(`missing source map ${operation.operationId}`);
  if (mapping.method !== operation.method.toUpperCase() || mapping.path !== operation.path) {
    throw new Error(`source map route mismatch ${operation.operationId}`);
  }
  if (["post", "put", "patch", "delete"].includes(operation.method) && !mapping.existingCommand) {
    throw new Error(`missing existing command ${operation.operationId}`);
  }
  if (mapping.newBusinessBehavior !== false)
    throw new Error(`new business behavior ${operation.operationId}`);
  if (!Array.isArray(mapping.sourceEvidence) || mapping.sourceEvidence.length === 0) {
    throw new Error(`missing source evidence ${operation.operationId}`);
  }
  if (!Array.isArray(mapping.sourceSymbols) || mapping.sourceSymbols.length === 0) {
    throw new Error(`missing source symbol ${operation.operationId}`);
  }
  if (mapping.sourceEvidence.every((entry) => entry.path.endsWith("/index.ts"))) {
    throw new Error(`re-export-only source evidence ${operation.operationId}`);
  }
  if (requireLocal) {
    let combined = "";
    for (const evidence of mapping.sourceEvidence) {
      if (!fs.existsSync(evidence.path)) {
        throw new Error(`local source missing ${operation.operationId}:${evidence.path}`);
      }
      combined += `${fs.readFileSync(evidence.path, "utf8")}\n`;
      if (evidence.blobSha && blob(evidence.path) !== evidence.blobSha) {
        throw new Error(`source blob drift ${operation.operationId}:${evidence.path}`);
      }
    }
    for (const symbol of mapping.sourceSymbols) {
      const tokens = meaningfulTokens(symbol);
      if (tokens.length > 0 && !tokens.some((token) => combined.includes(token))) {
        throw new Error(`source symbol not found ${operation.operationId}:${symbol}`);
      }
    }
  }
}
if (byId.size !== operations(doc).length) throw new Error("orphan endpoint source map");

for (const [name, schema] of Object.entries(doc.components.schemas)) {
  const mapping = schemaMaps[name];
  if (!mapping) throw new Error(`missing schema source ${name}`);
  if (mapping.classification === "TRANSPORT_METADATA" && mapping.sourceFile === null) continue;
  if (!mapping.sourceFile || !mapping.sourceSymbol) throw new Error(`weak schema source ${name}`);
  if (mapping.sourceFile.endsWith("/index.ts"))
    throw new Error(`re-export-only schema evidence ${name}`);
  if (requireLocal) {
    if (!fs.existsSync(mapping.sourceFile)) throw new Error(`local schema source missing ${name}`);
    const source = fs.readFileSync(mapping.sourceFile, "utf8");
    const tokens = meaningfulTokens(mapping.sourceSymbol);
    if (tokens.length > 0 && !tokens.some((token) => source.includes(token))) {
      throw new Error(`schema source symbol missing ${name}:${mapping.sourceSymbol}`);
    }
    if (mapping.blobSha && blob(mapping.sourceFile) !== mapping.blobSha) {
      throw new Error(`schema source blob drift ${name}:${mapping.sourceFile}`);
    }
  }
  void schema;
}
for (const name of Object.keys(schemaMaps)) {
  if (!doc.components.schemas[name]) throw new Error(`orphan schema source ${name}`);
}
console.log(
  `source maps passed: ${byId.size} operations, ${Object.keys(schemaMaps).length} schemas${
    requireLocal ? " with local source verification" : ""
  }`,
);
