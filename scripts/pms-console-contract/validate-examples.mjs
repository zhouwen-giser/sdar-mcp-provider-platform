/* global console */
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { contract, readJson } from "./lib.mjs";

const mapping = {
  "problem.json": "ProblemDetails",
  "provider-type.json": "ProviderType",
  "provider-package.json": "ProviderPackage",
  "provider.json": "Provider",
  "resource.json": "Resource",
  "provider-resource-binding.json": "ProviderResourceBinding",
  "configuration-draft.json": "ConfigurationDraft",
  "effective-configuration-preview.json": "EffectiveConfigurationPreview",
  "configuration-publication-result.json": "ConfigurationPublicationResult",
  "runtime-deployment.json": "RuntimeDeployment",
  "runtime-deployment-intent.json": "RuntimeDeploymentIntent",
  "runtime-process.json": "RuntimeProcess",
  "registry-snapshot.json": "RegistrySnapshot",
  "registry-diff.json": "RegistryDiff",
  "audit-event.json": "AuditEvent",
};
const examples = fs
  .readdirSync(path.join(contract, "examples"))
  .filter((file) => file.endsWith(".json"))
  .sort();
if (JSON.stringify(examples) !== JSON.stringify(Object.keys(mapping).sort())) {
  throw new Error("example-to-schema mapping is incomplete");
}

for (const file of examples) {
  const schemaName = mapping[file];
  const schema = readJson(path.join(contract, "schemas", `${schemaName}.schema.json`));
  const instance = readJson(path.join(contract, "examples", file));
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(instance)) {
    throw new Error(`example validation failed ${file}: ${JSON.stringify(validate.errors)}`);
  }
}
console.log(`generated-schema example validation passed: ${examples.length}`);
