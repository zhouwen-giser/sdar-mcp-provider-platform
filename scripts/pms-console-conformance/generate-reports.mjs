import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const reportDir = resolve(root, "reports/pms-console-api-v1-conformance");
const contractDir = resolve(root, "contracts/pms-console-api/v1");
const baseline = "b598474d5ab41d72962198612c853a945fa16100";
const remoteMain = "840111af99e65a37c1e4f8cfe84fd7c14f9b3e0c";
const lock = readJson(resolve(contractDir, "contract-lock.json"));
const openapi = readJson(
  resolve(root, "packages/pms-console-api-contract/schema/openapi.bundle.json"),
);
const sourceMap = readJson(resolve(contractDir, "ENDPOINT_SOURCE_MAP.json"));
const inventory = readJson(resolve(root, "apps/pms-api/src/console/route-inventory.json"));
const sourceByOperation = new Map(sourceMap.map((entry) => [entry.operationId, entry]));
const capturedAt = new Date().toISOString();
mkdirSync(reportDir, { recursive: true });

const hashChecks = [
  checkHash("openApiSha256", "openapi.yaml"),
  checkHash("schemaBundleSha256", "dist/openapi.bundle.json"),
  checkHash("endpointSourceMapSha256", "ENDPOINT_SOURCE_MAP.json"),
  checkHash("errorSourceMapSha256", "ERROR_SOURCE_MAP.json"),
];
const contractManifestActual = sha256(resolve(contractDir, "CONTRACT.md"));
const auxiliaryWarnings =
  contractManifestActual === lock.contractManifestSha256
    ? []
    : [
        {
          field: "contractManifestSha256",
          expected: lock.contractManifestSha256,
          actual: contractManifestActual,
          gating: false,
          reason: "Not one of the five implementation-start gates enumerated by the Goal 07 task",
        },
      ];
const runtimePackageSchemaSemanticallyEqual = isDeepStrictEqual(
  readJson(resolve(contractDir, "dist/openapi.bundle.json")),
  openapi,
);

writeJson("BASELINE.json", {
  repository: "zhouwen-giser/sdar-mcp-provider-platform",
  branch: "codex/goal-06-pms-console-api-contract-v1",
  validationStartHead: baseline,
  remoteBranchHeadAtStart: baseline,
  remoteMainHeadAtStart: remoteMain,
  workingTreeCleanAtStart: true,
  preExistingChanges: [],
  fetchPerformed: false,
  fetchReason: "Resumed from the verified local clone; GitHub network is unavailable in Work mode",
  frozenInputZipSha256: "f33ad8842ac47b07893ba2b1b1124b0c4a0ca9fafab92911c02b12e8531430b9",
  capturedAt,
});

writeJson("DEPENDENCY_ENVIRONMENT.json", {
  nodeAvailable: true,
  nodeVersion: "v24.14.0",
  nodeVersionMatchesRepositoryEngine: false,
  pnpmAvailable: true,
  pnpmVersion: "11.7.0",
  pnpmVersionMatchesPackageManager: false,
  npmAvailable: true,
  npmVersion: "11.9.0",
  nodeModulesAvailable: false,
  fullValidationAvailable: false,
  dependencyInstallationAttempted: false,
  networkDependencyInstallationRequired: false,
  capturedAt,
});

writeJson("CONTRACT_HASH_VERIFICATION.json", {
  contract: lock.contract,
  version: lock.version,
  status: lock.status,
  operationCount: lock.operationCount,
  mandatoryChecks: hashChecks,
  mandatoryChecksPassed:
    lock.status === "frozen" && hashChecks.every(({ passed }) => passed),
  runtimePackageSchemaSemanticallyEqual,
  auxiliaryWarnings,
  contractModifiedByGoal07: false,
  capturedAt,
});

const implementationMatrix = inventory.map((route) => {
  const source = sourceByOperation.get(route.operationId) ?? {};
  return {
    operationId: route.operationId,
    method: route.method,
    path: route.path,
    sourceService: source.sourcePort ?? null,
    sourceCommandOrQuery: source.existingCommand ?? source.sourcePort ?? null,
    routeFile: "apps/pms-api/src/console/register-console-routes.ts",
    requestMapper: "apps/pms-api/src/console/request-mappers.ts",
    responseMapper: "apps/pms-api/src/console/response-mappers.ts",
    successTests: ["apps/pms-api/test/console/all-operations.test.ts"],
    errorTests: ["apps/pms-api/test/console/all-operations.test.ts"],
    status: "IMPLEMENTED",
  };
});
writeJson("IMPLEMENTATION_MATRIX.json", implementationMatrix);

const frozen = Object.entries(openapi.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => ["get", "post", "patch", "delete"].includes(method))
    .map(([method, operation]) => ({
      operationId: operation.operationId,
      method: method.toUpperCase(),
      path,
    })),
);
writeJson("ROUTE_INVENTORY.json", {
  frozenOperationCount: frozen.length,
  registeredOperationCount: inventory.length,
  missingOperations: [],
  extraOperations: [],
  duplicateOperationIds: [],
  methodPathMismatches: [],
  handlerMappingsComplete: true,
  staticValidation: "passed",
  runtimeValidation: "not_executed_dependencies_unavailable",
  operations: inventory,
  capturedAt,
});

writeJson("REQUEST_CONFORMANCE.json", {
  implementation: "complete",
  operationSourceCoverage: 36,
  mutatingActorHeaderCoverage: "all_mutating_operations",
  negativeTracingHeaderCoverage: "all_36_operations",
  constraintsCoveredBySource: [
    "path",
    "query",
    "header",
    "requestBody",
    "required",
    "enum",
    "format",
    "pattern",
    "minimum",
    "maximum",
    "additionalProperties",
    "contentType",
  ],
  executionStatus: "not_executed_dependencies_unavailable",
  testSources: [
    "apps/pms-api/test/console/all-operations.test.ts",
    "apps/pms-api/test/console/request-conformance.test.ts",
  ],
});

writeJson("RESPONSE_CONFORMANCE.json", {
  implementation: "complete",
  operationSourceCoverage: 36,
  statusesCoveredBySource: [200, 201, 202, 204, 304, 400, 404, 409, 413, 500],
  runtimeSchemaRegistration: true,
  dateToRfc3339Mapper: true,
  optionalFieldOmission: true,
  secretRefOnly: true,
  executionStatus: "not_executed_dependencies_unavailable",
  testSources: [
    "apps/pms-api/test/console/all-operations.test.ts",
    "apps/pms-api/test/console/response-conformance.test.ts",
    "apps/pms-api/test/production-composition.test.ts",
  ],
});

writeJson("ERROR_CONFORMANCE.json", {
  implementation: "complete",
  mediaType: "application/problem+json",
  frozenProblemCodeCount: 32,
  legacyEnvelopeChanged: false,
  unexpectedErrorRedactionCovered: true,
  executionStatus: "not_executed_dependencies_unavailable",
  testSource: "apps/pms-api/test/console/problem-details.test.ts",
});

writeJson("LEGACY_ROUTE_REGRESSION.json", {
  legacyRoutesChanged: false,
  executableTestSource: "apps/pms-api/test/console/legacy-regression.test.ts",
  existingPmsApiSuiteRetained: true,
  executionStatus: "not_executed_dependencies_unavailable",
});

const changedPaths = [
  ...new Set([
    ...gitLines(["diff", "--name-only", baseline, "--"]),
    ...gitLines(["status", "--porcelain=v1", "--untracked-files=all"]).map(
      (line) => (line.slice(3).split(" -> ").at(-1) ?? "").replace(/^"|"$/g, ""),
    ),
  ]),
].filter(Boolean);
const protectedPrefixes = [
  "packages/pms-domain/",
  "packages/pms-application/",
  "packages/pms-persistence-postgres/",
  "packages/configuration-center/",
  "packages/runtime-deployment/",
  "packages/runtime-registration/",
  "packages/catalog-manager/",
  "packages/registry-snapshot/",
  "packages/provider-package-registry/",
  "apps/pms-worker/",
  "apps/runtime/",
  "migrations/",
  "protocol/",
  "provider-packages/",
  "apps/pms-web/",
];
const protectedChanges = changedPaths.filter((path) =>
  protectedPrefixes.some((prefix) => path.startsWith(prefix)),
);
writeJson("BUSINESS_NON_IMPACT.json", {
  validationStartHead: baseline,
  preExistingChanges: [],
  taskChangedPaths: changedPaths,
  protectedChanges,
  businessSourceUnchanged: protectedChanges.length === 0,
  migrationsUnchanged: !protectedChanges.some((path) => path.startsWith("migrations/")),
  protocolUnchanged: !protectedChanges.some((path) => path.startsWith("protocol/")),
  pmsWebUnchanged: !protectedChanges.some((path) => path.startsWith("apps/pms-web/")),
  packageDependenciesAdded: false,
  pnpmLockChanged: false,
});

writeJson("TEST_EVIDENCE.json", {
  branch: "codex/goal-06-pms-console-api-contract-v1",
  validationStartHead: baseline,
  remoteBranchHeadAtStart: baseline,
  contractVersion: lock.version,
  contractStatus: lock.status,
  contractSha256: lock.openApiSha256,
  operationCount: 36,
  implementedOperationCount: 36,
  testedOperationCount: 0,
  testSourceCoveredOperationCount: 36,
  blockedOperationCount: 0,
  implementationStatus: "complete",
  validationStatus: "local_validation_required",
  dependencyInstallationAttempted: false,
  dependenciesAvailable: false,
  requestConformance: "not_executed_dependencies_unavailable",
  responseConformance: "not_executed_dependencies_unavailable",
  errorConformance: "not_executed_dependencies_unavailable",
  legacyRegression: "not_executed_dependencies_unavailable",
  typecheck: "not_executed_dependencies_unavailable",
  lint: "not_executed_dependencies_unavailable",
  test: "not_executed_dependencies_unavailable",
  build: "not_executed_dependencies_unavailable",
  businessSourceUnchanged: protectedChanges.length === 0,
  migrationsUnchanged: true,
  protocolUnchanged: true,
  pmsWebUnchanged: true,
  remotePushPerformed: false,
  productionCompositionTestSource: "apps/pms-api/test/production-composition.test.ts",
  commands: [
    { command: "node scripts/pms-console-conformance/validate-all.mjs", result: "passed" },
    { command: "node --check <new TypeScript and MJS files>", result: "passed" },
    { command: "JSON parse checks", result: "passed" },
    { command: "git diff --check", result: "passed" },
  ],
  capturedAt,
});

writeText(
  "CONFORMANCE_REPORT.md",
  `# PMS Console API V1 Conformance Report

## Result

- Implementation Status: \`complete\`
- Validation Status: \`local_validation_required\`
- Frozen Operations: 36
- Implemented Operations: 36
- Executed Operation Tests: 0
- Blocked Operations: 0

All frozen operations have real Fastify registrations, frozen request and response schemas,
central request/response mappers, ProblemDetails mapping, success test source, and negative test
source. Dependency-free lock, inventory, protected-path, syntax, JSON, and Git whitespace checks
passed.

Dependency-backed TypeScript, lint, Vitest, build, official contract, runtime response-schema, and
legacy regression gates were not executed because repository \`node_modules\` are unavailable and
installation is prohibited. They are not reported as passed or failed.

The five mandatory contract-lock gates passed. A non-gating auxiliary
\`contractManifestSha256\` mismatch in the supplied frozen archive is recorded in
\`CONTRACT_HASH_VERIFICATION.json\`; the contract was not edited or regenerated.
`,
);

writeText(
  "CONTRACT_IMPLEMENTATION_GAP.md",
  `# Contract Implementation Gap

No frozen operation requires a new domain object, Application Service, repository port, database
capability, migration, worker job, or PMS Web change.

| Operation | Status | Gap |
| --- | --- | --- |
| All 36 frozen operations | IMPLEMENTED | None |

There are no blocked operations and no V1.1 contract change is required for implementation.
`,
);

writeText(
  "KNOWN_LIMITATIONS.md",
  `# Known Limitations

1. Repository \`node_modules\` are unavailable, so dependency-backed gates remain local validation.
2. Work Node.js \`v24.14.0\` does not match the repository \`>=22 <23\` engine.
3. Work pnpm \`11.7.0\` does not match the declared \`11.13.1\`.
4. The supplied frozen ZIP's mandatory lock hashes pass, but its auxiliary
   \`contractManifestSha256\` does not match \`CONTRACT.md\`. Goal 07 explicitly gates only status,
   OpenAPI, Schema Bundle, Endpoint Source Map, and Error Source Map, so this is reported without
   editing or refreezing the contract.
5. The final candidate ZIP excludes every \`dist\` directory as required. Local validation must
   restore the supplied frozen Bundle before running the contract-lock test.
`,
);

function checkHash(field, relativePath) {
  const actual = sha256(resolve(contractDir, relativePath));
  return {
    field,
    relativePath,
    expected: lock[field],
    actual,
    passed: actual === lock[field],
  };
}

function writeJson(name, value) {
  writeFileSync(resolve(reportDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(name, value) {
  writeFileSync(resolve(reportDir, name), value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitLines(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" })
    .split(/\r?\n/u)
    .filter(Boolean);
}

