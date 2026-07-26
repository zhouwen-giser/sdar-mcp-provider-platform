import { z } from "zod";

export const CONFIGURATION_DEFINITION_SCHEMA_VERSION = "1.0" as const;

export const CONFIGURATION_APPLY_MODES = [
  "hot_reload",
  "reconnect_required",
  "restart_required",
  "immutable",
] as const;

export const CONFIGURATION_TARGET_TYPES = [
  "environment",
  "provider_type",
  "provider",
  "runtime_deployment",
  "runtime_instance",
  "collector",
] as const;

export const CONFIGURATION_INHERITANCE_LEVELS = [
  ...CONFIGURATION_TARGET_TYPES,
  "system_default",
] as const;

export const CONFIGURATION_OVERRIDE_MODES = ["inheritable", "target_only", "forbidden"] as const;

export type ConfigurationApplyMode = (typeof CONFIGURATION_APPLY_MODES)[number];
export type ConfigurationTargetType = (typeof CONFIGURATION_TARGET_TYPES)[number];
export type ConfigurationInheritanceLevel = (typeof CONFIGURATION_INHERITANCE_LEVELS)[number];
export type ConfigurationOverrideMode = (typeof CONFIGURATION_OVERRIDE_MODES)[number];

const JsonPointerSchema = z
  .string()
  .regex(/^(?:\/(?:[^~/]|~0|~1)*)+$/, "Expected a non-root RFC 6901 JSON Pointer");

const OverridePolicySchema = z.strictObject({
  mode: z.enum(CONFIGURATION_OVERRIDE_MODES),
  allowedTargetTypes: z
    .array(z.enum(CONFIGURATION_TARGET_TYPES))
    .min(1)
    .refine(allUnique)
    .optional(),
});

const ConfigurationFieldMetadataSchema = z.strictObject({
  path: JsonPointerSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  applyMode: z.enum(CONFIGURATION_APPLY_MODES),
  required: z.boolean(),
  secret: z.boolean(),
  overridePolicy: OverridePolicySchema,
});

const ConfigurationInheritanceSchema = z.strictObject({
  enabled: z.boolean(),
  order: z.array(z.enum(CONFIGURATION_INHERITANCE_LEVELS)).refine(allUnique),
});

const ConfigurationDefinitionInputSchema = z.strictObject({
  schemaVersion: z.literal(CONFIGURATION_DEFINITION_SCHEMA_VERSION),
  definitionId: z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/),
  definitionVersion: z.number().int().positive(),
  configGroup: z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/),
  targetTypes: z.array(z.enum(CONFIGURATION_TARGET_TYPES)).min(1).refine(allUnique),
  inheritance: ConfigurationInheritanceSchema,
  schema: z.record(z.string(), z.unknown()),
  defaults: z.record(z.string(), z.unknown()),
  secretPaths: z.array(JsonPointerSchema).refine(allUnique),
  fields: z.array(ConfigurationFieldMetadataSchema).min(1),
});

export type ConfigurationDefinition = z.infer<typeof ConfigurationDefinitionInputSchema>;
export type ConfigurationFieldMetadata = ConfigurationDefinition["fields"][number];
export type ConfigurationOverridePolicy = ConfigurationFieldMetadata["overridePolicy"];

export type ConfigurationDefinitionErrorCode =
  | "CONFIGURATION_DEFINITION_INVALID"
  | "DUPLICATE_FIELD_PATH"
  | "SECRET_PATH_MISMATCH"
  | "IMMUTABLE_OVERRIDE_POLICY_INVALID"
  | "OVERRIDE_TARGET_OUTSIDE_DEFINITION"
  | "INHERITANCE_ORDER_INVALID";

export class ConfigurationDefinitionError extends Error {
  readonly code: ConfigurationDefinitionErrorCode;
  readonly details: Readonly<Record<string, string | readonly string[]>>;

  constructor(
    code: ConfigurationDefinitionErrorCode,
    message: string,
    details: Readonly<Record<string, string | readonly string[]>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConfigurationDefinitionError";
    this.code = code;
    this.details = details;
  }
}

export function parseConfigurationDefinition(input: unknown): ConfigurationDefinition {
  const parsed = ConfigurationDefinitionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigurationDefinitionError(
      "CONFIGURATION_DEFINITION_INVALID",
      "Configuration Definition does not match the v1 schema",
      { issues: parsed.error.issues.map(({ path, message }) => `${path.join(".")}: ${message}`) },
      { cause: parsed.error },
    );
  }
  assertDefinitionConsistency(parsed.data);
  return parsed.data;
}

function assertDefinitionConsistency(definition: ConfigurationDefinition): void {
  const paths = definition.fields.map(({ path }) => path);
  if (!allUnique(paths)) {
    throw new ConfigurationDefinitionError(
      "DUPLICATE_FIELD_PATH",
      "Configuration Definition contains duplicate field paths",
      { paths },
    );
  }

  const declaredSecretPaths = [...definition.secretPaths].sort();
  const metadataSecretPaths = definition.fields
    .filter(({ secret }) => secret)
    .map(({ path }) => path)
    .sort();
  if (
    declaredSecretPaths.length !== metadataSecretPaths.length ||
    declaredSecretPaths.some((path, index) => path !== metadataSecretPaths[index])
  ) {
    throw new ConfigurationDefinitionError(
      "SECRET_PATH_MISMATCH",
      "secretPaths must exactly match fields marked secret",
      { declaredSecretPaths, metadataSecretPaths },
    );
  }

  for (const field of definition.fields) {
    if (field.applyMode === "immutable" && field.overridePolicy.mode !== "forbidden") {
      throw new ConfigurationDefinitionError(
        "IMMUTABLE_OVERRIDE_POLICY_INVALID",
        `Immutable field must forbid overrides: ${field.path}`,
        { path: field.path },
      );
    }
    const outsideTargets = (field.overridePolicy.allowedTargetTypes ?? []).filter(
      (targetType) => !definition.targetTypes.includes(targetType),
    );
    if (outsideTargets.length > 0) {
      throw new ConfigurationDefinitionError(
        "OVERRIDE_TARGET_OUTSIDE_DEFINITION",
        `Field override target is outside the definition target types: ${field.path}`,
        { path: field.path, outsideTargets },
      );
    }
  }

  if (
    (!definition.inheritance.enabled && definition.inheritance.order.length > 0) ||
    (definition.inheritance.enabled && definition.inheritance.order.at(-1) !== "system_default")
  ) {
    throw new ConfigurationDefinitionError(
      "INHERITANCE_ORDER_INVALID",
      "Enabled inheritance must terminate at system_default; disabled inheritance must be empty",
      { order: definition.inheritance.order },
    );
  }
}

function allUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
