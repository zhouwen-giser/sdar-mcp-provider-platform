/* global console, process */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contract, operations, readJson, resolveLocalRef, stable } from "./lib.mjs";

const current = readJson(path.join(contract, "dist/openapi.bundle.json"));
const baseline = readJson(path.join(contract, "breaking-baseline/openapi.bundle.json"));

function dereference(doc, value) {
  return value?.$ref ? dereference(doc, resolveLocalRef(doc, value.$ref)) : (value ?? {});
}

function operationKey(operation) {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

function equal(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function compareSchema(oldValue, newValue, where, direction) {
  const oldSchema = dereference(baseline, oldValue);
  const newSchema = dereference(current, newValue);
  if (oldSchema.type !== undefined && !equal(oldSchema.type, newSchema.type)) {
    throw new Error(`type changed ${where}`);
  }
  if (oldSchema.format !== undefined && oldSchema.format !== newSchema.format) {
    throw new Error(`format changed ${where}`);
  }
  const oldEnum = oldSchema.enum ?? [];
  const newEnum = newSchema.enum ?? [];
  for (const value of oldEnum) {
    if (!newEnum.some((candidate) => equal(candidate, value))) {
      throw new Error(`enum narrowed ${where}:${JSON.stringify(value)}`);
    }
  }

  const oldRequired = new Set(oldSchema.required ?? []);
  const newRequired = new Set(newSchema.required ?? []);
  if (direction === "request") {
    for (const property of newRequired) {
      if (!oldRequired.has(property))
        throw new Error(`request field became required ${where}.${property}`);
    }
  } else {
    for (const property of oldRequired) {
      if (!newRequired.has(property))
        throw new Error(`required response field weakened ${where}.${property}`);
    }
  }

  for (const [property, schema] of Object.entries(oldSchema.properties ?? {})) {
    if (!(property in (newSchema.properties ?? {}))) {
      throw new Error(`property removed ${where}.${property}`);
    }
    compareSchema(schema, newSchema.properties[property], `${where}.${property}`, direction);
  }
  if (oldSchema.items !== undefined) {
    if (newSchema.items === undefined) throw new Error(`array items removed ${where}`);
    compareSchema(oldSchema.items, newSchema.items, `${where}[]`, direction);
  }
  for (const keyword of ["oneOf", "anyOf", "allOf"]) {
    if (oldSchema[keyword] !== undefined && !equal(oldSchema[keyword], newSchema[keyword])) {
      throw new Error(`${keyword} changed ${where}`);
    }
  }
}

function combinedParameters(doc, operationEntry) {
  const pathItem = doc.paths[operationEntry.path] ?? {};
  return [...(pathItem.parameters ?? []), ...(operationEntry.operation.parameters ?? [])].map(
    (parameter) => dereference(doc, parameter),
  );
}

const currentOperations = new Map(operations(current).map((entry) => [operationKey(entry), entry]));
for (const oldOperation of operations(baseline)) {
  const key = operationKey(oldOperation);
  const newOperation = currentOperations.get(key);
  if (!newOperation) throw new Error(`operation removed ${key}`);
  if (newOperation.operationId !== oldOperation.operationId) {
    throw new Error(`operationId changed ${key}`);
  }
  if (
    !equal(
      oldOperation.operation.security ?? baseline.security,
      newOperation.operation.security ?? current.security,
    )
  ) {
    throw new Error(`security requirement changed ${key}`);
  }

  const oldParameters = combinedParameters(baseline, oldOperation);
  const newParameters = combinedParameters(current, newOperation);
  const newByKey = new Map(
    newParameters.map((parameter) => [`${parameter.in}:${parameter.name}`, parameter]),
  );
  const oldKeys = new Set();
  for (const parameter of oldParameters) {
    const parameterKey = `${parameter.in}:${parameter.name}`;
    oldKeys.add(parameterKey);
    const candidate = newByKey.get(parameterKey);
    if (!candidate) throw new Error(`parameter removed ${key} ${parameterKey}`);
    if (parameter.required !== true && candidate.required === true) {
      throw new Error(`parameter became required ${key} ${parameterKey}`);
    }
    compareSchema(
      parameter.schema,
      candidate.schema,
      `${key} parameter ${parameterKey}`,
      "request",
    );
  }
  for (const parameter of newParameters) {
    const parameterKey = `${parameter.in}:${parameter.name}`;
    if (!oldKeys.has(parameterKey) && parameter.required === true) {
      throw new Error(`new required parameter ${key} ${parameterKey}`);
    }
  }

  const oldBody = oldOperation.operation.requestBody;
  const newBody = newOperation.operation.requestBody;
  if (oldBody && !newBody) throw new Error(`request body removed ${key}`);
  if (oldBody && newBody) {
    if (oldBody.required !== true && newBody.required === true) {
      throw new Error(`request body became required ${key}`);
    }
    const oldSchema = oldBody.content?.["application/json"]?.schema;
    const newSchema = newBody.content?.["application/json"]?.schema;
    if (oldSchema && !newSchema) throw new Error(`JSON request schema removed ${key}`);
    if (oldSchema) compareSchema(oldSchema, newSchema, `${key} request`, "request");
  }

  for (const [status, responseValue] of Object.entries(oldOperation.operation.responses ?? {})) {
    const newResponseValue = newOperation.operation.responses?.[status];
    if (!newResponseValue) throw new Error(`response status removed ${key} ${status}`);
    const oldResponse = dereference(baseline, responseValue);
    const newResponse = dereference(current, newResponseValue);
    for (const [mediaType, media] of Object.entries(oldResponse.content ?? {})) {
      const newMedia = newResponse.content?.[mediaType];
      if (!newMedia) throw new Error(`response media type removed ${key} ${status} ${mediaType}`);
      if (media.schema) {
        compareSchema(media.schema, newMedia.schema, `${key} response ${status}`, "response");
      }
    }
  }
}

compareSchema(
  baseline.components.schemas.ProblemCode,
  current.components.schemas.ProblemCode,
  "ProblemCode",
  "response",
);

const matureDiff = spawnSync(
  path.join(process.cwd(), "node_modules/.bin/openapi-changes"),
  [
    "report",
    "--reproducible",
    "--no-logo",
    path.join(contract, "breaking-baseline/openapi.bundle.json"),
    path.join(contract, "dist/openapi.bundle.json"),
  ],
  { encoding: "utf8" },
);
if (matureDiff.stderr) process.stderr.write(matureDiff.stderr);
if (matureDiff.status !== 0) process.exit(matureDiff.status ?? 1);
const matureReport = JSON.parse(matureDiff.stdout);
const matureBreakingCount = Object.values(matureReport.reportSummary ?? {}).reduce(
  (total, category) => total + (category.breakingChanges ?? 0),
  0,
);
if (matureBreakingCount !== 0) {
  throw new Error(`openapi-changes detected ${matureBreakingCount} breaking changes`);
}

console.log(
  "breaking checks passed with openapi-changes and custom coverage: operations, parameters, required fields, statuses, response fields, types, formats, enums, errors and security",
);
