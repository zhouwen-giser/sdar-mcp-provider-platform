import { z } from "zod";

/** Canonical development contract. JSON Schema and TypeScript types derive from these schemas. */
export const TASK_BUSINESS_PROFILE_VERSION = "1.0-rc2" as const;
export const TASK_BUSINESS_CONTEXT_SCHEMA_VERSION = "sdar.task-business-context/1.0-rc2" as const;
export const TASK_BUSINESS_FEEDBACK_SCHEMA_VERSION = "sdar.task-business-feedback/1.0-rc2" as const;

const identifier = z.string().min(1).max(256);
const revision = z.number().int().positive();
const contextRevision = z.number().int().nonnegative();
const recordedAt = z.iso.datetime({ offset: true });
const positiveSequence = z.string().regex(/^[1-9][0-9]{0,18}$/);

export const SourceBusinessCursorSchema = z
  .object({
    sourceId: identifier,
    sourceStreamId: identifier,
    sourceSequence: positiveSequence,
  })
  .strict();
export type SourceBusinessCursor = z.infer<typeof SourceBusinessCursorSchema>;

export const RuntimeBusinessCursorSchema = z
  .object({
    streamId: identifier,
    afterSequence: z.string().regex(/^(0|[1-9][0-9]{0,18})$/),
  })
  .strict();
export type RuntimeBusinessCursor = z.infer<typeof RuntimeBusinessCursorSchema>;

export const TaskBusinessIdentitySchema = z
  .object({
    taskId: identifier,
    executionId: identifier,
    providerId: identifier,
    resourceId: identifier,
    operationName: identifier,
    correlationId: identifier.optional(),
    simulationId: identifier.optional(),
  })
  .strict();
export type TaskBusinessIdentity = z.infer<typeof TaskBusinessIdentitySchema>;

// References inside a Context or feedback body inherit its verified Execution identity.
// A concrete revision is required so a later change cannot silently retarget a command.
export const BusinessObjectRefSchema = z
  .object({
    kind: z.enum(["artifact", "action", "input_request", "intervention"]),
    id: identifier,
    revision,
  })
  .strict();
export type BusinessObjectRef = z.infer<typeof BusinessObjectRefSchema>;

const artifactRef = BusinessObjectRefSchema.extend({ kind: z.literal("artifact") });
const actionRef = BusinessObjectRefSchema.extend({ kind: z.literal("action") });
const inputRef = BusinessObjectRefSchema.extend({ kind: z.literal("input_request") });
const interventionRef = BusinessObjectRefSchema.extend({ kind: z.literal("intervention") });

export const BusinessPhaseSchema = z
  .object({
    code: identifier,
    label: z.string().optional(),
    since: recordedAt,
    reasonCode: identifier.optional(),
  })
  .strict();

export const BusinessSummarySchema = z
  .object({
    status: z.enum(["in_progress", "finalized"]),
    resultCode: identifier.optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const BusinessActiveRefsSchema = z.record(identifier, BusinessObjectRefSchema);

/** Metadata fields are full replacements at one Context revision, including an empty activeRefs map. */
export const BusinessContextDeltaSchema = z
  .object({
    phase: BusinessPhaseSchema.nullable().optional(),
    summary: BusinessSummarySchema.optional(),
    activeRefs: BusinessActiveRefsSchema.optional(),
    effectivePlanRevision: contextRevision.optional(),
  })
  .strict();
export type BusinessContextDelta = z.infer<typeof BusinessContextDeltaSchema>;

export const TaskBusinessContextSchema = z
  .object({
    schemaVersion: z.literal(TASK_BUSINESS_CONTEXT_SCHEMA_VERSION),
    identity: TaskBusinessIdentitySchema,
    contextRevision,
    effectivePlanRevision: contextRevision,
    phase: BusinessPhaseSchema.nullable(),
    summary: BusinessSummarySchema,
    activeRefs: BusinessActiveRefsSchema,
    artifactRefs: z.array(artifactRef),
    actionRefs: z.array(actionRef),
    requiredInputRefs: z.array(inputRef),
    interventionRefs: z.array(interventionRef),
    updatedAt: recordedAt,
    finalizedAt: recordedAt.optional(),
  })
  .strict();
export type TaskBusinessContext = z.infer<typeof TaskBusinessContextSchema>;

export const BusinessEventChangeSchema = z
  .object({
    eventType: identifier,
    severity: z.enum(["info", "warning", "critical"]),
    reasonCode: identifier,
    description: z.string(),
    subjects: z.array(BusinessObjectRefSchema).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    contextDelta: BusinessContextDeltaSchema.optional(),
    legacyAlias: z
      .object({
        sourceId: identifier,
        sourceStreamId: identifier,
        sourceSequence: positiveSequence,
        sourceEventId: identifier,
      })
      .strict()
      .optional(),
  })
  .strict();

export const ArtifactChangedSchema = z
  .object({
    change: z.enum(["create", "update", "invalidate", "archive"]),
    artifactRef,
    previousRevision: revision.optional(),
    reasonCode: identifier,
    changedFields: z.array(identifier).optional(),
  })
  .strict();

export const ActionChangedSchema = z
  .object({
    change: z.enum(["create", "update"]),
    actionRef,
    previousRevision: revision.optional(),
    reasonCode: identifier,
  })
  .strict();

export const RequiredInputChangedSchema = z
  .object({
    change: z.enum(["create", "update"]),
    requestRef: inputRef,
    previousRevision: revision.optional(),
    reasonCode: identifier,
  })
  .strict();

export const InterventionChangedSchema = z
  .object({
    change: z.enum(["create", "update"]),
    interventionRef,
    previousRevision: revision.optional(),
    reasonCode: identifier,
  })
  .strict();

export const BusinessContextFinalizedSchema = z
  .object({
    reasonCode: identifier,
    finalContextRevision: contextRevision,
    summary: BusinessSummarySchema.extend({ status: z.literal("finalized") }),
    artifactRefs: z.array(artifactRef),
    actionRefs: z.array(actionRef),
    finalizedAt: recordedAt,
  })
  .strict();

const feedbackCommon = {
  schemaVersion: z.literal(TASK_BUSINESS_FEEDBACK_SCHEMA_VERSION),
  contextRevision,
  providerRecordedAt: recordedAt,
};

export const TaskBusinessFeedbackBodySchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...feedbackCommon,
      kind: z.literal("BUSINESS_EVENT"),
      payload: BusinessEventChangeSchema,
    })
    .strict(),
  z
    .object({
      ...feedbackCommon,
      kind: z.literal("ARTIFACT_CHANGED"),
      payload: ArtifactChangedSchema,
    })
    .strict(),
  z
    .object({ ...feedbackCommon, kind: z.literal("ACTION_CHANGED"), payload: ActionChangedSchema })
    .strict(),
  z
    .object({
      ...feedbackCommon,
      kind: z.literal("REQUIRED_INPUT_CHANGED"),
      payload: RequiredInputChangedSchema,
    })
    .strict(),
  z
    .object({
      ...feedbackCommon,
      kind: z.literal("INTERVENTION_CHANGED"),
      payload: InterventionChangedSchema,
    })
    .strict(),
  z
    .object({
      ...feedbackCommon,
      kind: z.literal("CONTEXT_FINALIZED"),
      payload: BusinessContextFinalizedSchema,
    })
    .strict(),
]);
export type TaskBusinessFeedbackBody = z.infer<typeof TaskBusinessFeedbackBodySchema>;

const knownFeedbackKindNames = [
  "BUSINESS_EVENT",
  "ARTIFACT_CHANGED",
  "ACTION_CHANGED",
  "REQUIRED_INPUT_CHANGED",
  "INTERVENTION_CHANGED",
  "CONTEXT_FINALIZED",
] as const;
const knownFeedbackKinds = new Set<string>(knownFeedbackKindNames);

/** Unknown optional kinds remain opaque data; they never imply an Action or command. */
export const OptionalTaskBusinessExtensionSchema = z
  .object({
    schemaVersion: z.literal(TASK_BUSINESS_FEEDBACK_SCHEMA_VERSION),
    kind: identifier,
    required: z.literal(false),
    contextRevision,
    providerRecordedAt: recordedAt,
    payload: z.json(),
  })
  .strict()
  .refine((message) => !knownFeedbackKinds.has(message.kind), "KNOWN_KIND_CANNOT_BE_OPAQUE");
export type OptionalTaskBusinessExtension = z.infer<typeof OptionalTaskBusinessExtensionSchema>;

export function parseTaskBusinessFeedbackBody(
  input: unknown,
): TaskBusinessFeedbackBody | OptionalTaskBusinessExtension {
  if (input && typeof input === "object" && "schemaVersion" in input) {
    const version = input.schemaVersion;
    if (typeof version === "string" && version !== TASK_BUSINESS_FEEDBACK_SCHEMA_VERSION) {
      throw new Error("UNSUPPORTED_BUSINESS_SCHEMA_VERSION");
    }
  }
  const known = TaskBusinessFeedbackBodySchema.safeParse(input);
  if (known.success) return known.data;
  const optional = OptionalTaskBusinessExtensionSchema.safeParse(input);
  if (optional.success) return optional.data;
  throw new Error("BUSINESS_PAYLOAD_INVALID");
}

export function taskBusinessCoreJsonSchemas(): {
  identity: object;
  sourceCursor: object;
  runtimeCursor: object;
  context: object;
  feedbackBody: object;
  optionalExtension: object;
} {
  const optionalExtension = z.toJSONSchema(OptionalTaskBusinessExtensionSchema);
  const properties = optionalExtension.properties as
    Record<string, Record<string, unknown>> | undefined;
  if (!properties?.kind) throw new Error("OPTIONAL_EXTENSION_SCHEMA_KIND_MISSING");
  // Zod refinements are not represented by toJSONSchema. Preserve this boundary
  // for JSON Schema consumers as well as the canonical parser.
  properties.kind.not = { enum: [...knownFeedbackKindNames] };
  return {
    identity: z.toJSONSchema(TaskBusinessIdentitySchema),
    sourceCursor: z.toJSONSchema(SourceBusinessCursorSchema),
    runtimeCursor: z.toJSONSchema(RuntimeBusinessCursorSchema),
    context: z.toJSONSchema(TaskBusinessContextSchema),
    feedbackBody: z.toJSONSchema(TaskBusinessFeedbackBodySchema),
    optionalExtension,
  };
}
