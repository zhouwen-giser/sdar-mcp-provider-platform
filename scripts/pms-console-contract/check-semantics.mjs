/* global console */
import fs from "node:fs";
import path from "node:path";
import { contract, operations, readJson, resolveLocalRef } from "./lib.mjs";

const doc = readJson(path.join(contract, "openapi.yaml"));
const contractOperations = operations(doc);
const byId = new Map(contractOperations.map((entry) => [entry.operationId, entry.operation]));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function schemaForResponse(operationId, status) {
  const response = byId.get(operationId)?.responses?.[status];
  const resolved = response?.$ref ? resolveLocalRef(doc, response.$ref) : response;
  return resolved?.content?.["application/json"]?.schema;
}

function bodyFor(operationId) {
  return byId.get(operationId)?.requestBody?.content?.["application/json"]?.schema;
}

function requiredBodyField(operationId, field) {
  const body = bodyFor(operationId);
  assert(body?.required?.includes(field), `${operationId} must require ${field}`);
  assert(body?.properties?.[field] !== undefined, `${operationId} must define ${field}`);
}

assert(
  contractOperations.length === 36,
  `expected 36 operations, found ${contractOperations.length}`,
);
assert(doc.security === undefined, "root security must remain absent");
assert(doc.components.securitySchemes === undefined, "security schemes must remain absent");
for (const entry of contractOperations) {
  assert(
    entry.operation.security === undefined,
    `operation security must remain absent: ${entry.operationId}`,
  );
}

const forbiddenPathFragments = [
  "/auth",
  "/login",
  "/logout",
  "/users",
  "/roles",
  "/incidents",
  "/changes",
  "/approvals",
  "/dashboard",
  "/catalog",
  "/worker-jobs",
  "/operations",
  "/logs",
];
for (const entry of contractOperations) {
  assert(
    !forbiddenPathFragments.some((fragment) => entry.path.toLowerCase().includes(fragment)),
    `forbidden V1 surface ${entry.path}`,
  );
}
assert(doc.components.schemas.EntityStatus === undefined, "generic EntityStatus must not exist");

const draft = doc.components.schemas.ConfigurationDraft;
const draftRequired = [
  "draftId",
  "definitionId",
  "definitionVersion",
  "key",
  "ancestorTargetIds",
  "content",
  "version",
  "status",
  "validationIssues",
  "createdAt",
  "updatedAt",
];
assert(
  JSON.stringify(draft.required) === JSON.stringify(draftRequired),
  "ConfigurationDraft required fields drift",
);
assert(
  JSON.stringify(draft.properties.status.enum) ===
    JSON.stringify(["draft", "validated", "invalid"]),
  "ConfigurationDraft status enum drift",
);
assert(
  draft.properties.applyMode !== undefined && !draft.required.includes("applyMode"),
  "applyMode must be optional",
);
assert(
  schemaForResponse("validateConfigurationDraft", "200")?.$ref ===
    "#/components/schemas/ConfigurationDraft",
  "configuration validation must return updated ConfigurationDraft",
);

const preview = doc.components.schemas.EffectiveConfigurationPreview;
assert(
  preview.properties.sources.type === "object",
  "EffectiveConfigurationPreview.sources must be a map",
);
assert(
  typeof preview.properties.sources.additionalProperties === "object",
  "EffectiveConfigurationPreview.sources must define map values",
);

const publication = doc.components.schemas.ConfigurationPublicationResult;
assert(
  JSON.stringify(publication.required) === JSON.stringify(["outcome", "revision"]),
  "ConfigurationPublicationResult required fields drift",
);
assert(
  JSON.stringify(publication.properties.outcome.enum) ===
    JSON.stringify(["published", "no_change"]),
  "ConfigurationPublicationResult outcome drift",
);
for (const operationId of ["publishConfigurationDraft", "rollbackConfigurationDraft"]) {
  assert(
    schemaForResponse(operationId, "200")?.$ref ===
      "#/components/schemas/ConfigurationPublicationResult",
    `${operationId} response drift`,
  );
}

const problem = doc.components.schemas.ProblemDetails;
assert(!problem.required.includes("retryable"), "ProblemDetails.retryable must not be required");
assert(problem.properties.retryable === undefined, "ProblemDetails.retryable is ungrounded");

for (const operationId of ["updateProviderStatus", "updateResourceStatus"]) {
  requiredBodyField(operationId, "expectedUpdatedAt");
}
requiredBodyField("updateConfigurationDraft", "expectedVersion");
for (const operationId of ["publishConfigurationDraft", "rollbackConfigurationDraft"]) {
  requiredBodyField(operationId, "expectedDraftVersion");
  requiredBodyField(operationId, "expectedPublishedRevision");
}
for (const operationId of [
  "startRuntimeDeployment",
  "stopRuntimeDeployment",
  "restartRuntimeDeployment",
  "scaleRuntimeDeployment",
  "reconcileRuntimeDeployment",
]) {
  requiredBodyField(operationId, "expectedDesiredRevision");
}

const registryLatest = byId.get("getLatestRegistrySnapshot");
const registryParameters = registryLatest.parameters.map((parameter) =>
  parameter.$ref ? resolveLocalRef(doc, parameter.$ref) : parameter,
);
assert(
  registryParameters.some(
    (parameter) => parameter.in === "header" && parameter.name === "If-None-Match",
  ),
  "Registry latest must preserve If-None-Match",
);
assert(registryLatest.responses["200"].headers?.ETag, "Registry latest 200 must expose ETag");
assert(registryLatest.responses["304"].headers?.ETag, "Registry latest 304 must expose ETag");

const publicationSource = fs.readFileSync(
  "packages/configuration-center/src/publication.ts",
  "utf8",
);
assert(
  publicationSource.includes('"configuration.rolled_back"'),
  "local rollback audit action is not configuration.rolled_back",
);
const configurationSource = fs.readFileSync("packages/configuration-center/src/model.ts", "utf8");
for (const symbol of ["ConfigurationDraft", "EffectiveConfigurationPreview"]) {
  assert(
    configurationSource.includes(`interface ${symbol}`),
    `local configuration symbol missing ${symbol}`,
  );
}
const registrySource = fs.readFileSync("apps/pms-api/src/registry-routes.ts", "utf8");
for (const symbol of ["if-none-match", 'header("etag"', "reply.status(304)"]) {
  assert(registrySource.includes(symbol), `local Registry ETag behavior missing ${symbol}`);
}

console.log("non-negotiable semantic assertions passed");
