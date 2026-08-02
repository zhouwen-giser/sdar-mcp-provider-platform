/* global console, process */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contract, readJson, hashFile } from "./lib.mjs";

const file = path.join(contract, "contract-lock.json");
if (!fs.existsSync(file)) throw new Error("frozen lock not generated");
const lock = readJson(file);
const baseline = readJson(path.join(contract, "BASELINE.json"));
const remote = readJson(
  path.join(process.cwd(), "reports/pms-console-api-contract-v1/REMOTE_CURRENCY_EVIDENCE.json"),
);
const candidatePath = path.join(contract, "contract-candidate.json");

for (const [key, relativeFile] of [
  ["openApiSha256", "openapi.yaml"],
  ["schemaBundleSha256", "dist/openapi.bundle.json"],
  ["endpointSourceMapSha256", "ENDPOINT_SOURCE_MAP.json"],
  ["errorSourceMapSha256", "ERROR_SOURCE_MAP.json"],
  ["schemaSourceMapSha256", "SCHEMA_SOURCE_MAP.json"],
  ["businessBaselineSha256", "business-baseline.sha256"],
  ["businessFinalSha256", "business-final.sha256"],
  ["freezeExceptionsSha256", "FREEZE_EXCEPTIONS.json"],
]) {
  if (lock[key] !== hashFile(path.join(contract, relativeFile))) {
    throw new Error(`lock mismatch ${key}`);
  }
}
if (
  lock.generatedTypesSha256 !==
  hashFile(path.join(process.cwd(), "packages/pms-console-api-contract/src/dto.d.ts"))
) {
  throw new Error("lock mismatch generatedTypesSha256");
}
if (lock.contractManifestSha256 !== hashFile(candidatePath)) {
  throw new Error("lock mismatch contractManifestSha256");
}

const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (head.status !== 0) throw new Error("unable to resolve final local HEAD");
const expectedBindings = {
  validationStartHead: baseline.validationStartHead,
  finalLocalHead: head.stdout.trim(),
  remoteBranchHeadAtStart: baseline.remoteBranchHeadAtStart,
  remoteBranchHeadAtEnd: remote.remoteBranchHeadAtEnd,
  remoteMainHeadAtStart: baseline.remoteMainHeadAtStart,
  businessMergeBase: baseline.businessMergeBase,
};
for (const [key, value] of Object.entries(expectedBindings)) {
  if (lock[key] !== value) throw new Error(`lock Git binding mismatch ${key}`);
}
const openapi = readJson(path.join(contract, "openapi.yaml"));
const manifest = readJson(candidatePath);
if (
  lock.status !== "frozen" ||
  lock.frozenFromCandidateVersion !== "3" ||
  openapi["x-contract-status"] !== "frozen" ||
  manifest.status !== "frozen" ||
  manifest.freezeReady !== true ||
  lock.authenticationScope !== "deferred" ||
  lock.businessSourceUnchanged !== true ||
  lock.repositoryGatesAcceptedWithNonContractExceptions !== true ||
  lock.remoteBranchIsAncestorAtStart !== true ||
  lock.remoteBranchIsAncestorAtEnd !== true
) {
  throw new Error("lock flags invalid");
}
console.log("frozen lock passed");
