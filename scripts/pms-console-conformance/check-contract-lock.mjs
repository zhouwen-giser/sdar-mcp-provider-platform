import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const contract = resolve(root, "contracts/pms-console-api/v1");
const lock = readJson(resolve(contract, "contract-lock.json"));
const mandatory = {
  openApiSha256: "openapi.yaml",
  schemaBundleSha256: "dist/openapi.bundle.json",
  endpointSourceMapSha256: "ENDPOINT_SOURCE_MAP.json",
  errorSourceMapSha256: "ERROR_SOURCE_MAP.json",
};
const checks = Object.entries(mandatory).map(([field, relativePath]) => {
  const path = resolve(contract, relativePath);
  const actual = sha256(path);
  return { field, relativePath, expected: lock[field], actual, passed: actual === lock[field] };
});
const runtimePackageSchemaSemanticallyEqual = isDeepStrictEqual(
  readJson(resolve(contract, "dist/openapi.bundle.json")),
  readJson(resolve(root, "packages/pms-console-api-contract/schema/openapi.bundle.json")),
);
const result = {
  contractStatus: lock.status,
  contractVersion: lock.version,
  operationCount: lock.operationCount,
  checks,
  runtimePackageSchemaSemanticallyEqual,
  passed:
    lock.status === "frozen" &&
    checks.every(({ passed }) => passed) &&
    runtimePackageSchemaSemanticallyEqual,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;

function sha256(path) {
  return createHash("sha256").update(canonicalContractBytes(path)).digest("hex");
}

function canonicalContractBytes(path) {
  const bytes = readFileSync(path);
  if (bytes.includes(13)) {
    return Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"), "utf8");
  }
  return bytes;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
