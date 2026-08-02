import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const contract = readJson(
  resolve(root, "packages/pms-console-api-contract/schema/openapi.bundle.json"),
);
const registered = readJson(resolve(root, "apps/pms-api/src/console/route-inventory.json"));
const source = readFileSync(
  resolve(root, "apps/pms-api/src/console/register-console-routes.ts"),
  "utf8",
);
const testSource = readFileSync(resolve(root, "apps/pms-api/test/console/helpers.ts"), "utf8");
const frozen = Object.entries(contract.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => ["get", "post", "patch", "delete"].includes(method))
    .map(([method, operation]) => ({
      operationId: operation.operationId,
      method: method.toUpperCase(),
      path,
    })),
);
const key = ({ operationId, method, path }) => `${operationId}|${method}|${path}`;
const frozenKeys = new Set(frozen.map(key));
const registeredKeys = new Set(registered.map(key));
const missing = frozen.filter((operation) => !registeredKeys.has(key(operation)));
const extra = registered.filter((operation) => !frozenKeys.has(key(operation)));
const duplicateOperationIds = duplicates(registered.map(({ operationId }) => operationId));
const missingHandlers = registered
  .map(({ operationId }) => operationId)
  .filter((operationId) => !source.includes(`${operationId}:`));
const missingTestCases = registered
  .map(({ operationId }) => operationId)
  .filter((operationId) => !testSource.includes(`"${operationId}"`));
const result = {
  frozenOperationCount: frozen.length,
  registeredOperationCount: registered.length,
  missing,
  extra,
  duplicateOperationIds,
  missingHandlers,
  missingTestCases,
  passed:
    frozen.length === registered.length &&
    missing.length === 0 &&
    extra.length === 0 &&
    duplicateOperationIds.length === 0 &&
    missingHandlers.length === 0 &&
    missingTestCases.length === 0,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;

function duplicates(values) {
  const seen = new Set();
  const result = new Set();
  for (const value of values) {
    if (seen.has(value)) result.add(value);
    seen.add(value);
  }
  return [...result];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
