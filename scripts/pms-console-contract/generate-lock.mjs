/* global console, process */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contract, hashFile, writeJson, readJson } from "./lib.mjs";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
}

run("git", ["rev-parse", "--is-inside-work-tree"]);
run("node", [
  "scripts/pms-console-contract/validate-all.mjs",
  "--freeze",
  "--approved-non-contract-exceptions",
]);

const baseline = readJson(path.join(contract, "BASELINE.json"));
const remote = readJson(
  path.join(process.cwd(), "reports/pms-console-api-contract-v1/REMOTE_CURRENCY_EVIDENCE.json"),
);
const exceptionPath = path.join(contract, "FREEZE_EXCEPTIONS.json");
const frozenAt = new Date().toISOString();
const finalLocalHead = git(["rev-parse", "HEAD"]);

if (
  remote.status !== "passed" ||
  remote.remoteBranchIsAncestorAtEnd !== true ||
  remote.finalLocalHead !== finalLocalHead
) {
  throw new Error("final remote currency evidence is not valid for the current HEAD");
}

const doc = readJson(path.join(contract, "openapi.yaml"));
doc["x-contract-status"] = "frozen";
doc.info.version = "1.0.0";
doc.info.description =
  "Contract Frozen from Candidate 3. Transport adapter contract only; authentication, authorization, RBAC, login and sessions remain deferred. X-Actor-ID remains audit context.";
writeJson(path.join(contract, "openapi.yaml"), doc);

const contractMd = path.join(contract, "CONTRACT.md");
let md = fs.readFileSync(contractMd, "utf8");
md = md.replace(
  "**Status: Contract Candidate 3 — freeze blocked by pre-existing branch scope and repository gates**",
  "**Status: Contract Frozen — V1.0, from Candidate 3**",
);
md = md.replace(
  "This package is not `Contract Frozen`. Local-source, generated-artifact and business non-impact checks passed, but pre-existing out-of-scope branch paths and the repository lint/format failures they contain block freeze. No `contract-lock.json` is present.",
  "This contract is frozen. The repository owner explicitly accepted the recorded pre-existing, non-protocol scope/lint/format findings in `FREEZE_EXCEPTIONS.json`; all protocol, local-source, generated-artifact, remote-currency and business non-impact gates passed.",
);
fs.writeFileSync(contractMd, md);

const jsPath = path.join(process.cwd(), "packages/pms-console-api-contract/src/index.js");
fs.writeFileSync(
  jsPath,
  fs
    .readFileSync(jsPath, "utf8")
    .replace(
      'PMS_CONSOLE_API_CONTRACT_STATUS = "candidate"',
      'PMS_CONSOLE_API_CONTRACT_STATUS = "frozen"',
    ),
);
const dtsPath = path.join(process.cwd(), "packages/pms-console-api-contract/src/index.d.ts");
fs.writeFileSync(
  dtsPath,
  fs
    .readFileSync(dtsPath, "utf8")
    .replace(
      'PMS_CONSOLE_API_CONTRACT_STATUS: "candidate"',
      'PMS_CONSOLE_API_CONTRACT_STATUS: "frozen"',
    ),
);
const pkgPath = path.join(process.cwd(), "packages/pms-console-api-contract/package.json");
const pkg = readJson(pkgPath);
pkg.version = "1.0.0";
writeJson(pkgPath, pkg);

run("node", ["scripts/pms-console-contract/generate-artifacts.mjs"]);
run("node", ["scripts/pms-console-contract/lint.mjs", "--frozen"]);
run("node", ["scripts/pms-console-contract/check-semantics.mjs"]);
run("node", ["scripts/pms-console-contract/check-enums.mjs"]);
run("node", ["scripts/pms-console-contract/check-sources.mjs", "--require-local"]);
run("node", ["scripts/pms-console-contract/check-errors.mjs", "--require-local"]);
run("node", ["scripts/pms-console-contract/check-schemas.mjs"]);
run("node", ["scripts/pms-console-contract/validate-examples.mjs"]);
run("node", ["scripts/pms-console-contract/check-breaking.mjs"]);
run("node", ["scripts/pms-console-contract/check-generated.mjs"]);
run("node", ["scripts/pms-console-contract/check-business-impact.mjs", "--require-complete"]);

const candidatePath = path.join(contract, "contract-candidate.json");
const candidate = readJson(candidatePath);
Object.assign(candidate, {
  status: "frozen",
  frozenFromCandidateVersion: "3",
  repositoryGatesVerified: false,
  repositoryGatesAcceptedWithNonContractExceptions: true,
  freezeReady: true,
  generatedAt: frozenAt,
  openApiSha256: hashFile(path.join(contract, "openapi.yaml")),
  schemaBundleSha256: hashFile(path.join(contract, "dist/openapi.bundle.json")),
  endpointSourceMapSha256: hashFile(path.join(contract, "ENDPOINT_SOURCE_MAP.json")),
  errorSourceMapSha256: hashFile(path.join(contract, "ERROR_SOURCE_MAP.json")),
  schemaSourceMapSha256: hashFile(path.join(contract, "SCHEMA_SOURCE_MAP.json")),
  generatedTypesSha256: hashFile(
    path.join(process.cwd(), "packages/pms-console-api-contract/src/dto.d.ts"),
  ),
  freezeExceptions: ["FREEZE_EXCEPTIONS.json"],
  freezeBlockers: [],
});
writeJson(candidatePath, candidate);

const lock = {
  schemaVersion: "1.0",
  contract: "pms-console-api",
  version: "1.0.0",
  frozenFromCandidateVersion: "3",
  status: "frozen",
  validationStartHead: baseline.validationStartHead,
  finalLocalHead,
  remoteBranchHeadAtStart: baseline.remoteBranchHeadAtStart,
  remoteBranchHeadAtEnd: remote.remoteBranchHeadAtEnd,
  remoteMainHeadAtStart: baseline.remoteMainHeadAtStart,
  businessMergeBase: baseline.businessMergeBase,
  remoteBranchIsAncestorAtStart: remote.remoteBranchIsAncestorAtStart,
  remoteBranchIsAncestorAtEnd: remote.remoteBranchIsAncestorAtEnd,
  openApiSha256: hashFile(path.join(contract, "openapi.yaml")),
  schemaBundleSha256: hashFile(path.join(contract, "dist/openapi.bundle.json")),
  endpointSourceMapSha256: hashFile(path.join(contract, "ENDPOINT_SOURCE_MAP.json")),
  errorSourceMapSha256: hashFile(path.join(contract, "ERROR_SOURCE_MAP.json")),
  schemaSourceMapSha256: hashFile(path.join(contract, "SCHEMA_SOURCE_MAP.json")),
  generatedTypesSha256: hashFile(
    path.join(process.cwd(), "packages/pms-console-api-contract/src/dto.d.ts"),
  ),
  contractManifestSha256: hashFile(candidatePath),
  freezeExceptionsSha256: hashFile(exceptionPath),
  businessBaselineSha256: hashFile(path.join(contract, "business-baseline.sha256")),
  businessFinalSha256: hashFile(path.join(contract, "business-final.sha256")),
  operationCount: 36,
  schemaCount: 28,
  exampleCount: 15,
  problemCodeCount: 32,
  businessSourceUnchanged: true,
  migrationsUnchanged: true,
  protocolUnchanged: true,
  repositoryGatesAcceptedWithNonContractExceptions: true,
  authenticationScope: "deferred",
  frozenAt,
};
writeJson(path.join(contract, "contract-lock.json"), lock);
run("node", ["scripts/pms-console-contract/check-lock.mjs"]);
console.log("Candidate 3 frozen lock generated");
