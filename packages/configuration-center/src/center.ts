import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type {
  ConfigurationApplyMode,
  ConfigurationDefinition,
  ConfigurationFieldMetadata,
  ConfigurationTargetType,
} from "@sdar/runtime-configuration-contract";
import { ConfigurationCenterError } from "./errors.js";
import type {
  ConfigurationBusinessKey,
  ConfigurationContent,
  ConfigurationDraft,
  ConfigurationPublicationSnapshot,
  ConfigurationValidationIssue,
  ConfigurationValue,
  CreateConfigurationDraft,
  EffectiveConfigurationPreview,
  SecretRef,
  UpdateConfigurationDraft,
} from "./model.js";

const applyModeRank: Readonly<Record<Exclude<ConfigurationApplyMode, "immutable">, number>> = {
  hot_reload: 0,
  reconnect_required: 1,
  restart_required: 2,
};

export class ConfigurationCenter {
  readonly #definitions = new Map<string, ConfigurationDefinition>();
  readonly #validators = new Map<string, ValidateFunction>();
  readonly #drafts = new Map<string, ConfigurationDraft>();
  readonly #businessKeys = new Map<string, string>();

  constructor(definitions: readonly ConfigurationDefinition[]) {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    });
    for (const definition of definitions) {
      if (this.#definitions.has(definition.definitionId)) {
        throw new ConfigurationCenterError(
          "CONFIGURATION_INPUT_INVALID",
          "Configuration definition IDs must be unique",
        );
      }
      this.#definitions.set(definition.definitionId, definition);
      this.#validators.set(definition.definitionId, ajv.compile(definition.schema));
    }
  }

  createDraft(input: CreateConfigurationDraft): ConfigurationDraft {
    validIdentifier(input.draftId, "draftId");
    const definition = this.#definition(input.definitionId);
    const key = normalizedKey(input.key);
    this.#assertTarget(definition, key);
    assertSecretRefs(definition, input.content);
    const encodedKey = businessKey(key);
    if (this.#drafts.has(input.draftId) || this.#businessKeys.has(encodedKey)) {
      throw new ConfigurationCenterError(
        "CONFIGURATION_BUSINESS_KEY_CONFLICT",
        "A configuration draft already exists for this business key",
      );
    }
    const now = validDate(input.now ?? new Date(), "now");
    const draft: ConfigurationDraft = {
      draftId: input.draftId,
      definitionId: definition.definitionId,
      definitionVersion: definition.definitionVersion,
      key,
      ancestorTargetIds: normalizedAncestors(input.ancestorTargetIds, definition, key.targetType),
      content: cloneContent(input.content),
      version: 1,
      status: "draft",
      validationIssues: [],
      createdAt: now,
      updatedAt: now,
    };
    this.#drafts.set(draft.draftId, draft);
    this.#businessKeys.set(encodedKey, draft.draftId);
    return cloneDraft(draft);
  }

  updateDraft(draftId: string, input: UpdateConfigurationDraft): ConfigurationDraft {
    const current = this.#draft(draftId);
    if (current.version !== input.expectedVersion) {
      throw new ConfigurationCenterError(
        "CONFIGURATION_DRAFT_VERSION_CONFLICT",
        "The configuration draft changed; reload and retry",
      );
    }
    const definition = this.#definition(current.definitionId);
    assertSecretRefs(definition, input.content);
    const resetCurrent: Omit<ConfigurationDraft, "applyMode"> = {
      draftId: current.draftId,
      definitionId: current.definitionId,
      definitionVersion: current.definitionVersion,
      key: current.key,
      ancestorTargetIds: current.ancestorTargetIds,
      content: current.content,
      version: current.version,
      status: current.status,
      validationIssues: current.validationIssues,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    };
    const updated: ConfigurationDraft = {
      ...resetCurrent,
      ancestorTargetIds:
        input.ancestorTargetIds === undefined
          ? current.ancestorTargetIds
          : normalizedAncestors(input.ancestorTargetIds, definition, current.key.targetType),
      content: cloneContent(input.content),
      version: current.version + 1,
      status: "draft",
      validationIssues: [],
      updatedAt: validDate(input.now ?? new Date(), "now"),
    };
    this.#drafts.set(draftId, updated);
    return cloneDraft(updated);
  }

  getDraft(draftId: string): ConfigurationDraft {
    return cloneDraft(this.#draft(draftId));
  }

  definitionForDraft(draftId: string): ConfigurationDefinition {
    return structuredClone(this.#definition(this.#draft(draftId).definitionId));
  }

  validateDraft(draftId: string): ConfigurationDraft {
    const current = this.#draft(draftId);
    const preview = this.#preview(current);
    const updated: ConfigurationDraft = {
      ...current,
      status: preview.valid ? "validated" : "invalid",
      applyMode: preview.applyMode,
      validationIssues: preview.issues,
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.#drafts.set(draftId, updated);
    return cloneDraft(updated);
  }

  effectivePreview(draftId: string): EffectiveConfigurationPreview {
    return clonePreview(this.#preview(this.#draft(draftId)));
  }

  requireValidatedDraft(draftId: string): ConfigurationDraft {
    const draft = this.#draft(draftId);
    if (draft.status !== "validated") {
      throw new ConfigurationCenterError(
        "CONFIGURATION_DRAFT_NOT_VALIDATED",
        "Only a validated configuration draft can be published",
      );
    }
    return cloneDraft(draft);
  }

  publicationSnapshot(
    draftId: string,
    expectedDraftVersion: number,
  ): ConfigurationPublicationSnapshot {
    const draft = this.#draft(draftId);
    if (draft.version !== expectedDraftVersion) {
      throw new ConfigurationCenterError(
        "CONFIGURATION_DRAFT_VERSION_CONFLICT",
        "The configuration draft changed; reload and retry",
      );
    }
    if (draft.status !== "validated") {
      throw new ConfigurationCenterError(
        "CONFIGURATION_DRAFT_NOT_VALIDATED",
        "Only a validated configuration draft can be published",
      );
    }
    const definition = this.#definition(draft.definitionId);
    const resolved = this.#resolve(draft, definition);
    if (resolved.issues.length > 0) {
      throw new ConfigurationCenterError(
        "CONFIGURATION_DRAFT_NOT_VALIDATED",
        "The effective configuration no longer passes validation",
      );
    }
    return structuredClone({
      draft,
      definition,
      effectiveContent: resolved.effective,
      applyMode: resolved.applyMode,
    });
  }

  #preview(draft: ConfigurationDraft): EffectiveConfigurationPreview {
    const definition = this.#definition(draft.definitionId);
    const resolved = this.#resolve(draft, definition);
    return {
      draftId: draft.draftId,
      definitionId: definition.definitionId,
      definitionVersion: definition.definitionVersion,
      content: redactSecrets(definition, resolved.effective),
      sources: resolved.sources,
      applyMode: resolved.applyMode,
      valid: resolved.issues.length === 0,
      issues: resolved.issues,
    };
  }

  #resolve(
    draft: ConfigurationDraft,
    definition: ConfigurationDefinition,
  ): {
    readonly effective: ConfigurationContent;
    readonly sources: Readonly<Record<string, "system_default" | ConfigurationTargetType>>;
    readonly applyMode: ConfigurationApplyMode;
    readonly issues: readonly ConfigurationValidationIssue[];
  } {
    const sources: Record<string, "system_default" | ConfigurationTargetType> = {};
    let effective = cloneContent(definition.defaults as ConfigurationContent);
    for (const field of definition.fields) {
      if (valueAt(effective, field.path) !== undefined) sources[field.path] = "system_default";
    }

    const order = definition.inheritance.enabled
      ? definition.inheritance.order
      : [draft.key.targetType];
    const currentIndex = order.indexOf(draft.key.targetType);
    const applicable = order
      .slice(currentIndex < 0 ? 0 : currentIndex)
      .filter((level): level is ConfigurationTargetType => level !== "system_default")
      .reverse();
    for (const targetType of applicable) {
      const layer =
        targetType === draft.key.targetType
          ? draft
          : this.#ancestorDraft(draft, targetType, draft.ancestorTargetIds[targetType]);
      if (layer === undefined) continue;
      effective = deepMerge(effective, layer.content);
      for (const field of definition.fields) {
        if (valueAt(layer.content, field.path) !== undefined) sources[field.path] = targetType;
      }
    }

    const issues = [
      ...overrideIssues(definition, draft),
      ...secretIssues(definition, effective),
      ...schemaIssues(this.#validators.get(definition.definitionId), definition, effective),
    ];
    return {
      effective,
      sources,
      applyMode: applyMode(definition.fields, draft.content),
      issues,
    };
  }

  #ancestorDraft(
    draft: ConfigurationDraft,
    targetType: ConfigurationTargetType,
    targetId: string | undefined,
  ): ConfigurationDraft | undefined {
    if (targetId === undefined) return undefined;
    const key: ConfigurationBusinessKey = { ...draft.key, targetType, targetId };
    const draftId = this.#businessKeys.get(businessKey(key));
    return draftId === undefined ? undefined : this.#drafts.get(draftId);
  }

  #definition(definitionId: string): ConfigurationDefinition {
    const definition = this.#definitions.get(definitionId);
    if (definition === undefined) {
      throw new ConfigurationCenterError(
        "CONFIGURATION_DEFINITION_NOT_FOUND",
        "The configuration definition does not exist",
      );
    }
    return definition;
  }

  #draft(draftId: string): ConfigurationDraft {
    const draft = this.#drafts.get(draftId);
    if (draft === undefined) {
      throw new ConfigurationCenterError(
        "CONFIGURATION_DRAFT_NOT_FOUND",
        "The configuration draft does not exist",
      );
    }
    return draft;
  }

  #assertTarget(definition: ConfigurationDefinition, key: ConfigurationBusinessKey): void {
    if (
      key.configGroup !== definition.configGroup ||
      !definition.targetTypes.includes(key.targetType)
    ) {
      throw new ConfigurationCenterError(
        "CONFIGURATION_TARGET_NOT_ALLOWED",
        "The configuration definition does not allow this target",
      );
    }
  }
}

function overrideIssues(
  definition: ConfigurationDefinition,
  draft: ConfigurationDraft,
): ConfigurationValidationIssue[] {
  const issues: ConfigurationValidationIssue[] = [];
  for (const field of definition.fields) {
    if (valueAt(draft.content, field.path) === undefined) continue;
    if (field.applyMode === "immutable" || field.overridePolicy.mode === "forbidden") {
      issues.push({
        code: "IMMUTABLE_OVERRIDE",
        path: field.path,
        message: "Immutable configuration fields cannot be overridden",
      });
    } else if (
      field.overridePolicy.allowedTargetTypes !== undefined &&
      !field.overridePolicy.allowedTargetTypes.includes(draft.key.targetType)
    ) {
      issues.push({
        code: "OVERRIDE_NOT_ALLOWED",
        path: field.path,
        message: "This field cannot be overridden at the selected target",
      });
    } else if (
      field.overridePolicy.mode === "target_only" &&
      definition.inheritance.order[0] !== draft.key.targetType
    ) {
      issues.push({
        code: "OVERRIDE_NOT_ALLOWED",
        path: field.path,
        message: "This field can only be set at the most specific target",
      });
    }
  }
  return issues;
}

function secretIssues(
  definition: ConfigurationDefinition,
  effective: ConfigurationContent,
): ConfigurationValidationIssue[] {
  return definition.secretPaths.flatMap((path) => {
    const value = valueAt(effective, path);
    return value === undefined || isSecretRef(value)
      ? []
      : [
          {
            code: "PLAINTEXT_SECRET_REJECTED" as const,
            path,
            message: "Secret configuration fields accept SecretRef values only",
          },
        ];
  });
}

function assertSecretRefs(
  definition: ConfigurationDefinition,
  content: ConfigurationContent,
): void {
  for (const path of definition.secretPaths) {
    const value = valueAt(content, path);
    if (value !== undefined && !isSecretRef(value)) {
      throw new ConfigurationCenterError(
        "CONFIGURATION_INPUT_INVALID",
        "Secret configuration fields accept SecretRef values only",
        { field: path },
      );
    }
  }
}

function schemaIssues(
  validator: ValidateFunction | undefined,
  definition: ConfigurationDefinition,
  effective: ConfigurationContent,
): ConfigurationValidationIssue[] {
  if (validator === undefined) return [];
  const candidate = cloneContent(effective);
  for (const path of definition.secretPaths) {
    const value = valueAt(candidate, path);
    if (isSecretRef(value)) setAt(candidate, path, schemaPlaceholder(definition.schema, path));
  }
  if (validator(candidate)) return [];
  return (validator.errors ?? []).map((error: ErrorObject) => ({
    code: "SCHEMA_VALIDATION_FAILED",
    path: error.instancePath || "/",
    message: `Configuration does not satisfy schema rule ${error.keyword}`,
  }));
}

function schemaPlaceholder(schema: Readonly<Record<string, unknown>>, path: string): string {
  let property: unknown = schema;
  for (const segment of pointerSegments(path)) {
    if (!isRecord(property) || !isRecord(property.properties)) break;
    property = property.properties[segment];
  }
  return isRecord(property) && typeof property.minLength === "number"
    ? "secret-ref-placeholder".padEnd(property.minLength, "x")
    : "secret-ref-placeholder";
}

function applyMode(
  fields: readonly ConfigurationFieldMetadata[],
  content: ConfigurationContent,
): ConfigurationApplyMode {
  let selected: Exclude<ConfigurationApplyMode, "immutable"> = "restart_required";
  let touched = false;
  for (const field of fields) {
    if (valueAt(content, field.path) === undefined || field.applyMode === "immutable") continue;
    const mode = field.applyMode;
    if (!touched || applyModeRank[mode] > applyModeRank[selected]) selected = mode;
    touched = true;
  }
  return touched ? selected : "restart_required";
}

function redactSecrets(
  definition: ConfigurationDefinition,
  content: ConfigurationContent,
): ConfigurationContent {
  const redacted = cloneContent(content);
  for (const path of definition.secretPaths) {
    if (valueAt(redacted, path) !== undefined) setAt(redacted, path, { secretRef: "[redacted]" });
  }
  return redacted;
}

function normalizedKey(input: ConfigurationBusinessKey): ConfigurationBusinessKey {
  return {
    environment: nonEmpty(input.environment, "environment"),
    targetType: input.targetType,
    targetId: nonEmpty(input.targetId, "targetId"),
    configGroup: nonEmpty(input.configGroup, "configGroup"),
    dataId: nonEmpty(input.dataId, "dataId"),
  };
}

function normalizedAncestors(
  input: Readonly<Partial<Record<ConfigurationTargetType, string>>> | undefined,
  definition: ConfigurationDefinition,
  currentTarget: ConfigurationTargetType,
): Readonly<Partial<Record<ConfigurationTargetType, string>>> {
  const result: Partial<Record<ConfigurationTargetType, string>> = {};
  for (const [targetType, targetId] of Object.entries(input ?? {})) {
    if (
      targetType === currentTarget ||
      !definition.inheritance.order.includes(targetType as ConfigurationTargetType)
    ) {
      throw new ConfigurationCenterError(
        "CONFIGURATION_INPUT_INVALID",
        "Ancestor targets must be allowed, distinct inheritance levels",
      );
    }
    result[targetType as ConfigurationTargetType] = nonEmpty(targetId, "ancestorTargetId");
  }
  return result;
}

function businessKey(key: ConfigurationBusinessKey): string {
  return JSON.stringify([
    key.environment,
    key.targetType,
    key.targetId,
    key.configGroup,
    key.dataId,
  ]);
}

function cloneDraft(draft: ConfigurationDraft): ConfigurationDraft {
  return structuredClone(draft);
}

function clonePreview(preview: EffectiveConfigurationPreview): EffectiveConfigurationPreview {
  return structuredClone(preview);
}

function cloneContent(content: ConfigurationContent): ConfigurationContent {
  if (!isRecord(content)) {
    throw new ConfigurationCenterError(
      "CONFIGURATION_INPUT_INVALID",
      "Configuration content must be an object",
    );
  }
  return structuredClone(content);
}

function deepMerge(
  base: ConfigurationContent,
  override: ConfigurationContent,
): ConfigurationContent {
  const result: Record<string, ConfigurationValue> = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    const prior = result[key];
    result[key] =
      isRecord(prior) && !isSecretRef(prior) && isRecord(value) && !isSecretRef(value)
        ? deepMerge(prior, value)
        : structuredClone(value);
  }
  return result;
}

function valueAt(root: ConfigurationContent, pointer: string): ConfigurationValue | undefined {
  let current: unknown = root;
  for (const segment of pointerSegments(pointer)) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current as ConfigurationValue | undefined;
}

function setAt(root: ConfigurationContent, pointer: string, value: ConfigurationValue): void {
  const segments = pointerSegments(pointer);
  let current = root as Record<string, ConfigurationValue>;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!isRecord(next)) return;
    current = next;
  }
  const last = segments.at(-1);
  if (last !== undefined) current[last] = value;
}

function pointerSegments(pointer: string): string[] {
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function isSecretRef(value: unknown): value is SecretRef {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value.secretRef === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/.test(value.secretRef)
  );
}

function isRecord(value: unknown): value is Record<string, ConfigurationValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIdentifier(value: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) invalid(name);
  return value;
}

function nonEmpty(value: string, name: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) invalid(name);
  return value;
}

function validDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid(name);
  return new Date(value);
}

function invalid(name: string): never {
  throw new ConfigurationCenterError(
    "CONFIGURATION_INPUT_INVALID",
    "A configuration input is invalid",
    { field: name },
  );
}
