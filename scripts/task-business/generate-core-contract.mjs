import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import {
  TASK_BUSINESS_PROFILE_VERSION,
  taskBusinessCoreJsonSchemas,
} from "../../packages/vehicle-provider-core/src/task-business-contract.ts";
import {
  TASK_BUSINESS_ARTIFACT_SCHEMA_VERSION,
  taskBusinessArtifactJsonSchema,
} from "../../packages/vehicle-provider-core/src/task-business-artifact.ts";
import { taskBusinessInteractionJsonSchemas } from "../../packages/vehicle-provider-core/src/task-business-interaction.ts";
import { taskBusinessOperationProfileJsonSchema } from "../../packages/adapter-protocol/src/task-business-profile.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, "protocol/task-business/v1/core.schema.json");
const artifactOutput = resolve(root, "protocol/task-business/v1/artifact.schema.json");
const interactionOutput = resolve(root, "protocol/task-business/v1/interaction.schema.json");
const operationProfileOutput = resolve(
  root,
  "protocol/task-business/v1/operation-profile.schema.json",
);
const expected = await prettier.format(
  JSON.stringify({
    profileVersion: TASK_BUSINESS_PROFILE_VERSION,
    source: "packages/vehicle-provider-core/src/task-business-contract.ts",
    schemas: taskBusinessCoreJsonSchemas(),
  }),
  { ...(await prettier.resolveConfig(output)), parser: "json" },
);
const artifactExpected = await prettier.format(
  JSON.stringify({
    profileVersion: TASK_BUSINESS_PROFILE_VERSION,
    schemaVersion: TASK_BUSINESS_ARTIFACT_SCHEMA_VERSION,
    source: "packages/vehicle-provider-core/src/task-business-artifact.ts",
    schema: taskBusinessArtifactJsonSchema(),
  }),
  { ...(await prettier.resolveConfig(artifactOutput)), parser: "json" },
);
const interactionExpected = await prettier.format(
  JSON.stringify({
    profileVersion: TASK_BUSINESS_PROFILE_VERSION,
    source: "packages/vehicle-provider-core/src/task-business-interaction.ts",
    schemas: taskBusinessInteractionJsonSchemas(),
  }),
  { ...(await prettier.resolveConfig(interactionOutput)), parser: "json" },
);
const operationProfileExpected = await prettier.format(
  JSON.stringify({
    profileVersion: TASK_BUSINESS_PROFILE_VERSION,
    source: "packages/adapter-protocol/src/task-business-profile.ts",
    schema: taskBusinessOperationProfileJsonSchema(),
  }),
  { ...(await prettier.resolveConfig(operationProfileOutput)), parser: "json" },
);

if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== expected) {
    throw new Error("TASK_BUSINESS_CORE_SCHEMA_OUT_OF_DATE");
  }
  if (readFileSync(artifactOutput, "utf8") !== artifactExpected) {
    throw new Error("TASK_BUSINESS_ARTIFACT_SCHEMA_OUT_OF_DATE");
  }
  if (readFileSync(interactionOutput, "utf8") !== interactionExpected) {
    throw new Error("TASK_BUSINESS_INTERACTION_SCHEMA_OUT_OF_DATE");
  }
  if (readFileSync(operationProfileOutput, "utf8") !== operationProfileExpected) {
    throw new Error("TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_OUT_OF_DATE");
  }
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, expected);
  writeFileSync(artifactOutput, artifactExpected);
  writeFileSync(interactionOutput, interactionExpected);
  writeFileSync(operationProfileOutput, operationProfileExpected);
}
