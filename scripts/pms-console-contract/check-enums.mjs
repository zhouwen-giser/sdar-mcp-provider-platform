/* global console */
import fs from "node:fs";
import path from "node:path";
import { contract, readJson } from "./lib.mjs";

const doc = readJson(path.join(contract, "openapi.yaml"));

function sourceText(file) {
  return fs.readFileSync(file, "utf8");
}

function typeValues(file, name) {
  const source = sourceText(file);
  const match = source.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?);`));
  if (!match) throw new Error(`local enum type missing ${name}:${file}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function constValues(file, name) {
  const source = sourceText(file);
  const match = source.match(
    new RegExp(`(?:export )?const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`),
  );
  if (!match) throw new Error(`local enum constant missing ${name}:${file}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function same(actual, expected, name) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${name} enum drift: contract=${JSON.stringify(actual)} local=${JSON.stringify(expected)}`,
    );
  }
}

const domain = "packages/pms-domain/src/entities.ts";
same(
  doc.components.schemas.ProviderType.properties.status.enum,
  typeValues(domain, "ProviderTypeStatus"),
  "ProviderType.status",
);
same(
  doc.components.schemas.Provider.properties.hostingMode.enum,
  constValues(domain, "PROVIDER_HOSTING_MODES"),
  "Provider.hostingMode",
);
same(
  doc.components.schemas.Provider.properties.status.enum,
  typeValues(domain, "ProviderStatus"),
  "Provider.status",
);
same(
  doc.components.schemas.Resource.properties.status.enum,
  typeValues(domain, "ResourceStatus"),
  "Resource.status",
);
same(
  doc.components.schemas.ConfigRevision.properties.status.enum,
  typeValues(domain, "ConfigRevisionStatus"),
  "ConfigRevision.status",
);
same(
  doc.components.schemas.ConfigRevision.properties.applyMode.enum,
  typeValues(domain, "ConfigurationApplyMode"),
  "ConfigRevision.applyMode",
);
same(
  doc.components.schemas.ConfigurationTarget.properties.targetType.enum,
  typeValues(domain, "ConfigurationTargetType"),
  "ConfigurationTarget.targetType",
);

const configuration = "packages/configuration-center/src/model.ts";
same(
  doc.components.schemas.ConfigurationDraft.properties.status.enum,
  typeValues(configuration, "ConfigurationDraftStatus"),
  "ConfigurationDraft.status",
);
same(
  doc.components.schemas.ConfigurationDraft.properties.applyMode.enum,
  typeValues(domain, "ConfigurationApplyMode"),
  "ConfigurationDraft.applyMode",
);

const deployment = "packages/runtime-deployment/src/model.ts";
same(
  doc.components.schemas.RuntimeDeployment.properties.desiredState.enum,
  constValues(deployment, "RUNTIME_DEPLOYMENT_DESIRED_STATES"),
  "RuntimeDeployment.desiredState",
);
same(
  doc.components.schemas.RuntimeDeployment.properties.status.enum,
  constValues(deployment, "RUNTIME_DEPLOYMENT_STATUSES"),
  "RuntimeDeployment.status",
);

const process = "packages/runtime-deployment/src/process.ts";
same(
  doc.components.schemas.RuntimeProcess.properties.processState.enum,
  constValues(process, "RUNTIME_PROCESS_STATES"),
  "RuntimeProcess.processState",
);
same(
  doc.components.schemas.RuntimeProcess.properties.observedHealth.enum,
  typeValues(process, "RuntimeObservedHealth"),
  "RuntimeProcess.observedHealth",
);
same(
  doc.components.schemas.RuntimeProcess.properties.registrationFreshness.enum,
  typeValues(
    "packages/pms-application/src/runtime-process-query.ts",
    "RuntimeRegistrationFreshness",
  ),
  "RuntimeProcess.registrationFreshness",
);

const providerPackage = "packages/provider-package-registry/src/model.ts";
same(
  doc.components.schemas.ProviderPackage.properties.qualification.properties.componentStatus.enum,
  constValues(providerPackage, "COMPONENT_QUALIFICATION_STATUSES"),
  "ProviderPackage.qualification.componentStatus",
);
same(
  doc.components.schemas.ProviderPackage.properties.qualification.properties.realResourceStatus
    .enum,
  constValues(providerPackage, "REAL_RESOURCE_QUALIFICATION_STATUSES"),
  "ProviderPackage.qualification.realResourceStatus",
);

assertNoGenericStatus(sourceText(path.join(contract, "openapi.yaml")));
function assertNoGenericStatus(text) {
  if (text.includes('"EntityStatus"')) throw new Error("generic UI EntityStatus is forbidden");
}

console.log("local source enum equality passed");
