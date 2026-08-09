import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format } from "prettier";
import type { ConfigurationDefinition } from "../model.js";
import { HomeAssistantClimateConfigurationDefinition } from "../providers/home-assistant.js";
import { HomeAssistantLightConfigurationDefinition } from "../providers/home-assistant-light.js";
import { NpcTankProviderConfigurationDefinition } from "../providers/npc-tank.js";
import { UgvProviderConfigurationDefinition } from "../providers/ugv.js";
import { RuntimeBootstrapConfigurationDefinition } from "../runtime/bootstrap.js";
import { RuntimeObservabilityConfigurationDefinition } from "../runtime/observability.js";
import { RuntimeWorkerEventsConfigurationDefinition } from "../runtime/worker-events.js";

export const PLATFORM_CONFIGURATION_DEFINITIONS: readonly ConfigurationDefinition[] = [
  RuntimeBootstrapConfigurationDefinition,
  RuntimeObservabilityConfigurationDefinition,
  RuntimeWorkerEventsConfigurationDefinition,
  UgvProviderConfigurationDefinition,
  NpcTankProviderConfigurationDefinition,
  HomeAssistantClimateConfigurationDefinition,
  HomeAssistantLightConfigurationDefinition,
].sort((left, right) => left.definitionId.localeCompare(right.definitionId));

export type ConfigurationArtifactKind = "schema" | "defaults" | "ui";

export interface ConfigurationArtifact {
  readonly definitionId: string;
  readonly kind: ConfigurationArtifactKind;
  readonly fileName: string;
  readonly content: string;
}

export async function buildConfigurationArtifacts(
  definitions: readonly ConfigurationDefinition[] = PLATFORM_CONFIGURATION_DEFINITIONS,
): Promise<readonly ConfigurationArtifact[]> {
  const groups = await Promise.all(
    [...definitions]
      .sort((left, right) => left.definitionId.localeCompare(right.definitionId))
      .map((definition) => buildDefinitionArtifacts(definition)),
  );
  return groups.flat();
}

export async function writeConfigurationArtifacts(
  outputDirectory: string,
  definitions: readonly ConfigurationDefinition[] = PLATFORM_CONFIGURATION_DEFINITIONS,
): Promise<readonly ConfigurationArtifact[]> {
  const artifacts = await buildConfigurationArtifacts(definitions);
  mkdirSync(outputDirectory, { recursive: true });
  for (const artifact of artifacts) {
    writeFileSync(join(outputDirectory, artifact.fileName), artifact.content);
  }
  return artifacts;
}

export async function checkConfigurationArtifactDrift(
  outputDirectory: string,
  definitions: readonly ConfigurationDefinition[] = PLATFORM_CONFIGURATION_DEFINITIONS,
): Promise<readonly string[]> {
  const artifacts = await buildConfigurationArtifacts(definitions);
  const expectedNames = new Set(artifacts.map(({ fileName }) => fileName));
  const drift: string[] = [];
  for (const artifact of artifacts) {
    let actual: string;
    try {
      actual = readFileSync(join(outputDirectory, artifact.fileName), "utf8");
    } catch {
      drift.push(`missing:${artifact.fileName}`);
      continue;
    }
    if (actual !== artifact.content) drift.push(`changed:${artifact.fileName}`);
  }
  let existingNames: string[];
  try {
    existingNames = readdirSync(outputDirectory).filter((name) => name.endsWith(".json"));
  } catch {
    return drift;
  }
  for (const name of existingNames.sort()) {
    if (!expectedNames.has(name)) drift.push(`unexpected:${name}`);
  }
  return drift;
}

async function buildDefinitionArtifacts(
  definition: ConfigurationDefinition,
): Promise<readonly ConfigurationArtifact[]> {
  const baseName = definition.definitionId;
  const schema = structuredClone(definition.schema);
  for (const path of definition.secretPaths) {
    const property = schemaPropertyAtPath(schema, path);
    property.writeOnly = true;
    property["x-sdar-secretRef"] = true;
    delete property.default;
  }

  return Promise.all([
    artifact(definition, "schema", {
      ...schema,
      $id: `https://schemas.sdar.dev/config/${baseName}/v${String(definition.definitionVersion)}`,
      title: definition.definitionId,
      "x-sdar-definition-version": definition.definitionVersion,
    }),
    artifact(definition, "defaults", {
      schemaVersion: definition.schemaVersion,
      definitionId: definition.definitionId,
      definitionVersion: definition.definitionVersion,
      values: definition.defaults,
    }),
    artifact(definition, "ui", {
      schemaVersion: definition.schemaVersion,
      definitionId: definition.definitionId,
      definitionVersion: definition.definitionVersion,
      configGroup: definition.configGroup,
      targetTypes: definition.targetTypes,
      inheritance: definition.inheritance,
      fields: definition.fields.map((field) => ({
        ...field,
        secretRef: field.secret,
        writeOnly: field.secret,
      })),
    }),
  ]);
}

async function artifact(
  definition: ConfigurationDefinition,
  kind: ConfigurationArtifactKind,
  value: unknown,
): Promise<ConfigurationArtifact> {
  return {
    definitionId: definition.definitionId,
    kind,
    fileName: `${definition.definitionId}.${kind}.json`,
    content: await format(JSON.stringify(sortJson(value)), { parser: "json", printWidth: 100 }),
  };
}

function schemaPropertyAtPath(
  schema: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const segments = path
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let current: unknown = schema;
  for (const segment of segments) {
    if (!record(current) || !record(current.properties)) {
      throw new Error(`CONFIGURATION_SCHEMA_SECRET_PATH_MISSING:${path}`);
    }
    current = current.properties[segment];
  }
  if (!record(current)) throw new Error(`CONFIGURATION_SCHEMA_SECRET_PATH_MISSING:${path}`);
  return current;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
