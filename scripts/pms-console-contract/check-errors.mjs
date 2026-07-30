/* global console, process */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contract, readJson } from "./lib.mjs";

const requireLocal = process.argv.includes("--require-local");
const doc = readJson(path.join(contract, "openapi.yaml"));
const codes = doc.components.schemas.ProblemCode.enum;
const maps = readJson(path.join(contract, "ERROR_SOURCE_MAP.json"));
const byCode = new Map(maps.map((entry) => [entry.problemCode, entry]));

function blob(file) {
  const result = spawnSync("git", ["hash-object", file], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

if (codes.some((code) => code.startsWith("MANAGEMENT_"))) {
  throw new Error("authentication errors must be deferred");
}
for (const code of codes) {
  const mapping = byCode.get(code);
  if (!mapping) throw new Error(`missing error source ${code}`);
  if (mapping.semanticChange !== false) throw new Error(`semantic error change ${code}`);
  if (mapping.retryable !== undefined) throw new Error(`unfrozen retryability policy ${code}`);
  if (!Array.isArray(mapping.sourceEvidence) || mapping.sourceEvidence.length === 0) {
    throw new Error(`missing error source evidence ${code}`);
  }
  if (requireLocal) {
    let combined = "";
    let hasConcreteSource = false;
    for (const evidence of mapping.sourceEvidence) {
      if (!fs.existsSync(evidence.path))
        throw new Error(`local error source missing ${code}:${evidence.path}`);
      if (!evidence.path.endsWith("/index.ts")) hasConcreteSource = true;
      combined += `${fs.readFileSync(evidence.path, "utf8")}\n`;
      if (evidence.blobSha && blob(evidence.path) !== evidence.blobSha) {
        throw new Error(`error source blob drift ${code}:${evidence.path}`);
      }
    }
    if (!hasConcreteSource) throw new Error(`re-export-only error evidence ${code}`);
    if (!combined.includes(mapping.sourceCode)) {
      throw new Error(`local error code symbol missing ${code}:${mapping.sourceCode}`);
    }
  }
}
if (byCode.size !== codes.length) throw new Error("orphan error source");

const expectedStatuses = {
  RUNTIME_DEPLOYMENT_NOT_FOUND: 404,
  RUNTIME_DEPLOYMENT_PROVIDER_UNAVAILABLE: 409,
  RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE: 409,
  RUNTIME_DEPLOYMENT_DATABASE_PROFILE_UNAVAILABLE: 409,
  RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED: 400,
  RUNTIME_DEPLOYMENT_REVISION_CONFLICT: 409,
};
for (const [code, status] of Object.entries(expectedStatuses)) {
  if (byCode.get(code)?.httpStatus !== status) throw new Error(`status mismatch ${code}`);
}
console.log(
  `error map passed: ${codes.length}${requireLocal ? " with local source verification" : ""}`,
);
