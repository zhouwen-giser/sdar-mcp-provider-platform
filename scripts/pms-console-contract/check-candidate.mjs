/* global console, process */
import path from "node:path";
import { contract, hashFile, readJson } from "./lib.mjs";

const candidate = readJson(path.join(contract, "contract-candidate.json"));
const baseline = readJson(path.join(contract, "BASELINE.json"));
if (
  candidate.status !== "candidate" ||
  candidate.freezeReady !== false ||
  candidate.repositoryGatesVerified !== false ||
  candidate.candidateGatesVerified !== true
) {
  throw new Error("candidate flags invalid");
}
if (candidate.authenticationScope !== "deferred") throw new Error("authentication scope mismatch");
for (const field of [
  "remoteBranchHeadAtStart",
  "remoteMainHeadAtStart",
  "validationStartHead",
  "businessMergeBase",
]) {
  if (candidate[field] !== baseline[field])
    throw new Error(`candidate dynamic baseline mismatch ${field}`);
}
for (const [field, file] of [
  ["openApiSha256", "openapi.yaml"],
  ["schemaBundleSha256", "dist/openapi.bundle.json"],
  ["endpointSourceMapSha256", "ENDPOINT_SOURCE_MAP.json"],
  ["errorSourceMapSha256", "ERROR_SOURCE_MAP.json"],
  ["schemaSourceMapSha256", "SCHEMA_SOURCE_MAP.json"],
]) {
  if (candidate[field] !== hashFile(path.join(contract, file))) {
    throw new Error(`candidate hash mismatch ${field}`);
  }
}
if (
  candidate.generatedTypesSha256 !==
  hashFile(path.join(process.cwd(), "packages/pms-console-api-contract/src/dto.d.ts"))
) {
  throw new Error("candidate hash mismatch generatedTypesSha256");
}
console.log("dynamic candidate manifest passed");
