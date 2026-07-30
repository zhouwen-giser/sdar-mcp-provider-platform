/* global console, process */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contract, operations, readJson, resolveLocalRef } from "./lib.mjs";

const file = path.join(contract, "openapi.yaml");
const redocly = path.join(process.cwd(), "node_modules/.bin/redocly");
const redoclyResult = spawnSync(
  redocly,
  ["lint", file, "--config", path.join(contract, "redocly.yaml")],
  { stdio: "inherit" },
);
if (redoclyResult.status !== 0) process.exit(redoclyResult.status ?? 1);

const doc = readJson(file);
if (doc.openapi !== "3.1.0") throw new Error("OpenAPI 3.1.0 required");
if (!["candidate", "frozen"].includes(doc["x-contract-status"])) {
  throw new Error("contract status must be candidate or frozen");
}
if (doc["x-authentication-scope"] !== "deferred") {
  throw new Error("authentication scope must be explicitly deferred");
}
if (doc.security !== undefined || doc.components?.securitySchemes !== undefined) {
  throw new Error("authentication/security schemes are out of V1 scope");
}
if (doc.servers?.[0]?.url !== "/api/console/v1") throw new Error("base path mismatch");

const contractOperations = operations(doc);
const ids = contractOperations.map((entry) => entry.operationId);
if (ids.some((id) => typeof id !== "string" || id.length === 0)) {
  throw new Error("operationId missing");
}
if (new Set(ids).size !== ids.length) throw new Error("duplicate operationId");

const refs = [];
function walk(node) {
  if (Array.isArray(node)) {
    node.forEach(walk);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (node.$ref) refs.push(node.$ref);
  Object.values(node).forEach(walk);
}
walk(doc);
for (const ref of refs) {
  if (resolveLocalRef(doc, ref) === undefined) throw new Error(`unresolved ref ${ref}`);
}

for (const entry of contractOperations) {
  if (entry.operation.security !== undefined) {
    throw new Error(`operation security is out of V1 scope: ${entry.operationId}`);
  }
  const pathTokens = [...entry.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  const parameters = (entry.operation.parameters ?? []).map((parameter) =>
    parameter.$ref ? resolveLocalRef(doc, parameter.$ref) : parameter,
  );
  for (const token of pathTokens) {
    const parameter = parameters.find(
      (candidate) => candidate.in === "path" && candidate.name === token,
    );
    if (!parameter || parameter.required !== true) {
      throw new Error(`missing required path parameter ${entry.operationId}:${token}`);
    }
  }
  if (
    !parameters.some(
      (parameter) => parameter.in === "header" && parameter.name === "X-Correlation-ID",
    )
  ) {
    throw new Error(`missing correlation header ${entry.operationId}`);
  }
  if (["post", "put", "patch", "delete"].includes(entry.method)) {
    const actor = parameters.some(
      (parameter) =>
        parameter.in === "header" && parameter.name === "X-Actor-ID" && parameter.required === true,
    );
    if (!actor) throw new Error(`missing audit actor header ${entry.operationId}`);
  }
  const responses = entry.operation.responses ?? {};
  if (!Object.keys(responses).some((status) => /^2\d\d$/.test(status))) {
    throw new Error(`missing success response ${entry.operationId}`);
  }
  if (!responses.default) throw new Error(`missing default Problem response ${entry.operationId}`);
}

const text = fs.readFileSync(file, "utf8");
for (const marker of ["TO" + "DO", "T" + "BD", "unresolved placeholder"]) {
  if (text.includes(marker)) throw new Error(`unresolved marker ${marker}`);
}
console.log(
  `standards and custom lint passed: ${contractOperations.length} operations, ${refs.length} refs`,
);
