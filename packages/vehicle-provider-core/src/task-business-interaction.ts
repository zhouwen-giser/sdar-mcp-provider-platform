import { isDeepStrictEqual } from "node:util";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { z } from "zod";
import type { RuntimeBusinessResponder } from "../../domain/src/business-responder.js";
import {
  BusinessObjectRefSchema,
  TaskBusinessIdentitySchema,
  type TaskBusinessIdentity,
} from "./task-business-contract.js";
import { compareIsoTimestamps } from "./time.js";

export const TASK_BUSINESS_ACTION_SCHEMA_VERSION = "sdar.business-action/1.0-rc2" as const;
export const TASK_BUSINESS_INPUT_SCHEMA_VERSION = "sdar.required-input/1.0-rc2" as const;
export const TASK_BUSINESS_INTERVENTION_SCHEMA_VERSION =
  "sdar.runtime-intervention/1.0-rc2" as const;
export const TASK_BUSINESS_INPUT_COMMAND_SCHEMA_VERSION =
  "sdar.required-input-response/1.0-rc2" as const;
export const TASK_BUSINESS_INTERVENTION_COMMAND_SCHEMA_VERSION =
  "sdar.runtime-intervention-command/1.0-rc2" as const;

const id = z.string().min(1).max(256);
const revision = z.number().int().positive();
const contextRevision = z.number().int().nonnegative();
const utc = z.iso.datetime({ offset: true });
const objectRefs = z.array(BusinessObjectRefSchema).max(100);
const inputSchema = z.record(id, z.unknown());

export const ActorRefSchema = z
  .object({
    type: z.enum(["device", "provider", "agent", "user", "operator", "system"]),
    actorId: id.optional(),
  })
  .strict();

export const BusinessActionSchema = z
  .object({
    schemaVersion: z.literal(TASK_BUSINESS_ACTION_SCHEMA_VERSION),
    actionId: id,
    actionType: z.enum([
      "sensor.visual_lock",
      "sensor.visual_reacquire",
      "navigation.replan",
      "recon.resume_scan",
    ]),
    identity: TaskBusinessIdentitySchema,
    revision,
    state: z.enum(["requested", "active", "completed", "failed", "cancelled"]),
    actor: ActorRefSchema,
    triggerOrigin: z.enum([
      "device_automatic",
      "provider_policy",
      "agent_command",
      "user_command",
      "operator_command",
      "unknown",
    ]),
    subjectRefs: objectRefs.optional(),
    cause: z
      .object({ messageId: id.optional(), eventType: id.optional(), policyRef: id.optional() })
      .strict()
      .optional(),
    reasonCode: id,
    requestedAt: utc.optional(),
    startedAt: utc.optional(),
    endedAt: utc.optional(),
    endReason: id.optional(),
    properties: z.record(id, z.unknown()).optional(),
  })
  .strict()
  .superRefine((action, ctx) => {
    if (
      action.startedAt &&
      action.requestedAt &&
      compareIsoTimestamps(action.startedAt, action.requestedAt) < 0
    ) {
      ctx.addIssue({ code: "custom", message: "ACTION_TIME_ORDER_INVALID", path: ["startedAt"] });
    }
    if (
      action.endedAt &&
      (action.startedAt ?? action.requestedAt) &&
      compareIsoTimestamps(action.endedAt, action.startedAt ?? action.requestedAt ?? "") < 0
    ) {
      ctx.addIssue({ code: "custom", message: "ACTION_TIME_ORDER_INVALID", path: ["endedAt"] });
    }
    if (
      action.state === "requested" &&
      (!action.requestedAt || action.startedAt || action.endedAt || action.endReason)
    ) {
      ctx.addIssue({ code: "custom", message: "ACTION_NOT_STARTED", path: ["state"] });
    }
    if (
      !action.requestedAt &&
      (action.actor.type !== "device" ||
        !["device_automatic", "unknown"].includes(action.triggerOrigin))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ACTION_REQUEST_TIME_REQUIRED",
        path: ["requestedAt"],
      });
    }
    if (action.state === "active" && (!action.startedAt || action.endedAt || action.endReason)) {
      ctx.addIssue({ code: "custom", message: "ACTION_ACTIVE_TIME_INVALID", path: ["state"] });
    }
    if (
      ["completed", "failed", "cancelled"].includes(action.state) &&
      (!action.endedAt || !action.endReason || (!action.startedAt && !action.requestedAt))
    ) {
      ctx.addIssue({ code: "custom", message: "ACTION_TERMINAL_REASON_REQUIRED", path: ["state"] });
    }
    if (
      action.actionType === "sensor.visual_lock" &&
      action.endReason === "VISUAL_LOCK_LOST" &&
      action.state !== "failed"
    ) {
      ctx.addIssue({ code: "custom", message: "VISUAL_LOSS_MUST_FAIL", path: ["state"] });
    }
  });
export type BusinessAction = z.infer<typeof BusinessActionSchema>;

export const InputSubjectBindingSchema = z.union([
  z
    .object({
      kind: z.literal("visual_lock"),
      targetId: id,
      lockSessionId: id,
      actionRef: BusinessObjectRefSchema.extend({ kind: z.literal("action") }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("artifact_revision"),
      artifactRef: BusinessObjectRefSchema.extend({ kind: z.literal("artifact") }),
    })
    .strict(),
]);

const disposition = z.enum(["release_and_resume_scan", "end_observation", "reissue_request"]);
export const RequiredInputSchema = z
  .object({
    schemaVersion: z.literal(TASK_BUSINESS_INPUT_SCHEMA_VERSION),
    requestId: id,
    requestKey: id,
    inputType: id,
    identity: TaskBusinessIdentitySchema,
    revision,
    blocking: z.literal(true),
    state: z.enum(["pending", "answered", "declined", "cancelled", "expired"]),
    requiredResponder: z.enum(["user", "agent", "operator"]),
    subjectBinding: InputSubjectBindingSchema,
    waitingPolicy: z.literal("pause_execution"),
    onExpire: disposition,
    onDismiss: disposition,
    onDecline: disposition,
    title: id,
    description: z.string().max(2_000).optional(),
    inputSchema,
    reasonCode: id,
    requestedAt: utc,
    deadlineAt: utc.optional(),
    resolvedAt: utc.optional(),
    responseCommandId: id.optional(),
    response: z
      .object({ action: z.enum(["accept", "decline", "cancel"]), value: z.unknown().optional() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.deadlineAt && compareIsoTimestamps(request.deadlineAt, request.requestedAt) <= 0) {
      ctx.addIssue({ code: "custom", message: "INPUT_DEADLINE_INVALID", path: ["deadlineAt"] });
    }
    if (
      request.state === "pending" &&
      (request.response || request.resolvedAt || request.responseCommandId)
    ) {
      ctx.addIssue({ code: "custom", message: "PENDING_INPUT_HAS_RESULT", path: ["state"] });
    }
    if (request.state !== "pending" && !request.resolvedAt) {
      ctx.addIssue({
        code: "custom",
        message: "INPUT_RESOLUTION_TIME_REQUIRED",
        path: ["resolvedAt"],
      });
    }
    if (request.resolvedAt && compareIsoTimestamps(request.resolvedAt, request.requestedAt) < 0) {
      ctx.addIssue({
        code: "custom",
        message: "INPUT_RESOLUTION_BEFORE_REQUEST",
        path: ["resolvedAt"],
      });
    }
    const expectedAction = {
      answered: "accept",
      declined: "decline",
    } as const;
    if (
      request.state in expectedAction &&
      request.response?.action !== expectedAction[request.state as keyof typeof expectedAction]
    ) {
      ctx.addIssue({
        code: "custom",
        message: "INPUT_STATE_RESPONSE_MISMATCH",
        path: ["response"],
      });
    }
    if (request.state === "expired" && request.response) {
      ctx.addIssue({ code: "custom", message: "EXPIRED_INPUT_HAS_RESPONSE", path: ["response"] });
    }
    if (
      request.state === "cancelled" &&
      request.response?.action !== undefined &&
      request.response.action !== "cancel"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "INPUT_STATE_RESPONSE_MISMATCH",
        path: ["response"],
      });
    }
    if (request.response && !request.responseCommandId) {
      ctx.addIssue({
        code: "custom",
        message: "INPUT_RESPONSE_COMMAND_REQUIRED",
        path: ["responseCommandId"],
      });
    }
    if (!request.response && request.responseCommandId) {
      ctx.addIssue({
        code: "custom",
        message: "INPUT_RESPONSE_COMMAND_UNEXPECTED",
        path: ["responseCommandId"],
      });
    }
  });
export type RequiredInput = z.infer<typeof RequiredInputSchema>;

export const RuntimeInterventionSchema = z
  .object({
    schemaVersion: z.literal(TASK_BUSINESS_INTERVENTION_SCHEMA_VERSION),
    interventionId: id,
    interventionType: z.enum([
      "navigation.adjust_plan",
      "navigation.change_destination",
      "recon.adjust_area",
      "recon.adjust_scan",
      "target.change_visual_lock",
    ]),
    identity: TaskBusinessIdentitySchema,
    revision,
    effectivePlanRevision: contextRevision,
    blocking: z.literal(false),
    state: z.enum([
      "available",
      "submitted",
      "applying",
      "applied",
      "failed",
      "expired",
      "withdrawn",
    ]),
    title: id,
    description: z.string().max(2_000).optional(),
    inputSchema,
    appliesTo: objectRefs.optional(),
    reasonCode: id,
    createdAt: utc,
    validUntil: utc.optional(),
    acceptedCommandId: id.optional(),
    resultRefs: objectRefs.optional(),
  })
  .strict()
  .superRefine((intervention, ctx) => {
    if (
      intervention.validUntil &&
      compareIsoTimestamps(intervention.validUntil, intervention.createdAt) <= 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "INTERVENTION_EXPIRY_INVALID",
        path: ["validUntil"],
      });
    }
    if (intervention.state === "available" && intervention.acceptedCommandId) {
      ctx.addIssue({
        code: "custom",
        message: "AVAILABLE_INTERVENTION_ALREADY_ACCEPTED",
        path: ["acceptedCommandId"],
      });
    }
    if (
      ["submitted", "applying", "applied", "failed"].includes(intervention.state) &&
      !intervention.acceptedCommandId
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ACCEPTED_COMMAND_REQUIRED",
        path: ["acceptedCommandId"],
      });
    }
    if (intervention.state === "applied" && !intervention.resultRefs?.length) {
      ctx.addIssue({ code: "custom", message: "APPLIED_RESULT_REQUIRED", path: ["resultRefs"] });
    }
  });
export type RuntimeIntervention = z.infer<typeof RuntimeInterventionSchema>;

export const BusinessGuardSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("semantic"), expectedRequestRevision: revision }).strict(),
  z.object({ mode: z.literal("legacy_strict"), expectedContextRevision: contextRevision }).strict(),
]);
export const InterventionGuardSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("semantic"),
      expectedInterventionRevision: revision,
      expectedEffectivePlanRevision: contextRevision,
    })
    .strict(),
  z.object({ mode: z.literal("legacy_strict"), expectedContextRevision: contextRevision }).strict(),
]);

export const RequiredInputResponseCommandSchema = z
  .object({
    schemaVersion: z.literal(TASK_BUSINESS_INPUT_COMMAND_SCHEMA_VERSION),
    commandId: id,
    taskId: id,
    executionId: id,
    requestId: id,
    requestKey: id,
    guard: BusinessGuardSchema,
    result: z
      .object({ action: z.enum(["accept", "decline", "cancel"]), value: z.unknown().optional() })
      .strict(),
  })
  .strict();
export type RequiredInputResponseCommand = z.infer<typeof RequiredInputResponseCommandSchema>;

export const RuntimeInterventionCommandSchema = z
  .object({
    schemaVersion: z.literal(TASK_BUSINESS_INTERVENTION_COMMAND_SCHEMA_VERSION),
    commandId: id,
    taskId: id,
    executionId: id,
    interventionId: id,
    guard: InterventionGuardSchema,
    input: z.record(id, z.unknown()),
  })
  .strict();
export type RuntimeInterventionCommand = z.infer<typeof RuntimeInterventionCommandSchema>;

function sameExecution(a: TaskBusinessIdentity, b: TaskBusinessIdentity): boolean {
  return (
    a.taskId === b.taskId &&
    a.executionId === b.executionId &&
    a.providerId === b.providerId &&
    a.resourceId === b.resourceId &&
    a.operationName === b.operationName
  );
}

export function assertActionTransition(previous: BusinessAction, next: BusinessAction): void {
  BusinessActionSchema.parse(next);
  if (
    !sameExecution(previous.identity, next.identity) ||
    previous.actionId !== next.actionId ||
    previous.actionType !== next.actionType
  ) {
    throw new Error("ACTION_IDENTITY_CHANGED");
  }
  if (next.revision !== previous.revision + 1) throw new Error("ACTION_REVISION_CONFLICT");
  if (
    next.requestedAt !== previous.requestedAt ||
    (previous.startedAt !== undefined && next.startedAt !== previous.startedAt)
  )
    throw new Error("ACTION_OBSERVATION_TIME_CHANGED");
  const allowed: Record<BusinessAction["state"], readonly BusinessAction["state"][]> = {
    requested: ["requested", "active", "failed", "cancelled"],
    active: ["active", "completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
  };
  if (!allowed[previous.state].includes(next.state))
    throw new Error("ACTION_STATE_TRANSITION_INVALID");
}

export function assertRequiredInputTransition(previous: RequiredInput, next: RequiredInput): void {
  RequiredInputSchema.parse(next);
  if (
    !sameExecution(previous.identity, next.identity) ||
    previous.requestId !== next.requestId ||
    previous.requestKey !== next.requestKey ||
    previous.inputType !== next.inputType
  ) {
    throw new Error("INPUT_IDENTITY_CHANGED");
  }
  if (next.revision !== previous.revision + 1) throw new Error("REQUEST_REVISION_CONFLICT");
  if (
    !isDeepStrictEqual(previous.inputSchema, next.inputSchema) ||
    !isDeepStrictEqual(previous.subjectBinding, next.subjectBinding) ||
    previous.requiredResponder !== next.requiredResponder ||
    previous.onExpire !== next.onExpire ||
    previous.onDismiss !== next.onDismiss ||
    previous.onDecline !== next.onDecline ||
    previous.requestedAt !== next.requestedAt ||
    previous.deadlineAt !== next.deadlineAt
  ) {
    throw new Error("NEW_REQUEST_REQUIRED");
  }
  if (previous.state !== "pending") {
    throw new Error("INPUT_STATE_TRANSITION_INVALID");
  }
}

export function assertInterventionTransition(
  previous: RuntimeIntervention,
  next: RuntimeIntervention,
): void {
  RuntimeInterventionSchema.parse(next);
  if (
    !sameExecution(previous.identity, next.identity) ||
    previous.interventionId !== next.interventionId ||
    previous.interventionType !== next.interventionType
  ) {
    throw new Error("INTERVENTION_IDENTITY_CHANGED");
  }
  if (next.revision !== previous.revision + 1) throw new Error("INTERVENTION_REVISION_CONFLICT");
  if (next.effectivePlanRevision !== previous.effectivePlanRevision)
    throw new Error("NEW_INTERVENTION_REQUIRED");
  if (
    !isDeepStrictEqual(previous.inputSchema, next.inputSchema) ||
    !isDeepStrictEqual(previous.appliesTo, next.appliesTo) ||
    previous.createdAt !== next.createdAt ||
    previous.validUntil !== next.validUntil
  ) {
    throw new Error("NEW_INTERVENTION_REQUIRED");
  }
  if (previous.acceptedCommandId && next.acceptedCommandId !== previous.acceptedCommandId) {
    throw new Error("INTERVENTION_COMMAND_CHANGED");
  }
  const allowed: Record<RuntimeIntervention["state"], readonly RuntimeIntervention["state"][]> = {
    available: ["available", "submitted", "expired", "withdrawn"],
    submitted: ["applying", "failed", "withdrawn"],
    applying: ["applied", "failed", "withdrawn"],
    applied: [],
    failed: [],
    expired: [],
    withdrawn: [],
  };
  if (!allowed[previous.state].includes(next.state))
    throw new Error("INTERVENTION_STATE_TRANSITION_INVALID");
}

export const TrustedResponderSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("runtime_authorization_context"),
      actorType: z.enum(["user", "agent", "operator"]),
      verified: z.literal(true),
    })
    .strict(),
  z
    .object({
      source: z.literal("runtime_development_policy"),
      actorType: z.literal("development_anonymous"),
      verified: z.literal(false),
    })
    .strict(),
]);
export type TrustedResponder = z.infer<typeof TrustedResponderSchema>;

/** Development policy is explicit audit provenance, never a claim of a verified human. */
export function taskBusinessResponder(responder: RuntimeBusinessResponder): TrustedResponder {
  return responder.source === "development"
    ? { source: "runtime_development_policy", actorType: "development_anonymous", verified: false }
    : { source: "runtime_authorization_context", actorType: responder.actorType, verified: true };
}

export function assertRequiredInputOpenAt(request: RequiredInput, now: Date): void {
  RequiredInputSchema.parse(request);
  if (!Number.isFinite(now.getTime())) throw new Error("BUSINESS_COMMAND_TIME_INVALID");
  if (request.state !== "pending") throw new Error("INPUT_NOT_PENDING");
  if (request.deadlineAt && now.getTime() >= Date.parse(request.deadlineAt)) {
    throw new Error("INPUT_DEADLINE_EXPIRED");
  }
}

export function assertInterventionAvailableAt(intervention: RuntimeIntervention, now: Date): void {
  RuntimeInterventionSchema.parse(intervention);
  if (!Number.isFinite(now.getTime())) throw new Error("BUSINESS_COMMAND_TIME_INVALID");
  if (intervention.state !== "available") throw new Error("INTERVENTION_NOT_AVAILABLE");
  if (intervention.validUntil && now.getTime() >= Date.parse(intervention.validUntil)) {
    throw new Error("INTERVENTION_EXPIRED");
  }
}

/** Pure preflight. The Runtime supplies responder from its authorization context, not command JSON. */
export function assessRequiredInputResponse(
  request: RequiredInput,
  command: RequiredInputResponseCommand,
  responder: unknown,
  currentContextRevision: number,
  currentSubjectBinding: RequiredInput["subjectBinding"],
  now: Date,
): {
  outcome: "accept" | "decline" | "cancel";
  nextDisposition: "await_result" | z.infer<typeof disposition>;
} {
  RequiredInputSchema.parse(request);
  RequiredInputResponseCommandSchema.parse(command);
  if (
    request.identity.taskId !== command.taskId ||
    request.identity.executionId !== command.executionId ||
    request.requestId !== command.requestId ||
    request.requestKey !== command.requestKey
  ) {
    throw new Error("INPUT_BINDING_INVALID");
  }
  assertRequiredInputOpenAt(request, now);
  const parsedResponder = TrustedResponderSchema.safeParse(responder);
  if (
    !parsedResponder.success ||
    (parsedResponder.data.source !== "runtime_development_policy" &&
      parsedResponder.data.actorType !== request.requiredResponder)
  ) {
    throw new Error("RESPONDER_NOT_AUTHORIZED");
  }
  if (!isDeepStrictEqual(request.subjectBinding, currentSubjectBinding)) {
    throw new Error("SUBJECT_NO_LONGER_VALID");
  }
  if (command.guard.mode === "semantic") {
    if (command.guard.expectedRequestRevision !== request.revision)
      throw new Error("REQUEST_REVISION_CONFLICT");
  } else if (command.guard.expectedContextRevision !== currentContextRevision) {
    throw new Error("CONTEXT_REVISION_CONFLICT");
  }
  if (command.result.action === "accept") {
    assertCommandInputSchema(
      request.inputSchema,
      command.result.value,
      "INVALID_INPUT_SCHEMA",
      "INVALID_INPUT_RESPONSE",
    );
  }
  return {
    outcome: command.result.action,
    nextDisposition:
      command.result.action === "accept"
        ? "await_result"
        : command.result.action === "cancel"
          ? request.onDismiss
          : request.onDecline,
  };
}

/** Pure preflight; the command registry checks an existing commandId before this new-command check. */
export function assertInterventionCommand(
  intervention: RuntimeIntervention,
  command: RuntimeInterventionCommand,
  currentContextRevision: number,
  currentEffectivePlanRevision: number,
  now: Date,
): void {
  RuntimeInterventionSchema.parse(intervention);
  RuntimeInterventionCommandSchema.parse(command);
  if (
    intervention.identity.taskId !== command.taskId ||
    intervention.identity.executionId !== command.executionId ||
    intervention.interventionId !== command.interventionId
  ) {
    throw new Error("INTERVENTION_BINDING_INVALID");
  }
  assertInterventionAvailableAt(intervention, now);
  if (intervention.effectivePlanRevision !== currentEffectivePlanRevision) {
    throw new Error("PLAN_REVISION_CONFLICT");
  }
  if (command.guard.mode === "semantic") {
    if (command.guard.expectedInterventionRevision !== intervention.revision)
      throw new Error("INTERVENTION_REVISION_CONFLICT");
    if (
      command.guard.expectedEffectivePlanRevision !== currentEffectivePlanRevision ||
      intervention.effectivePlanRevision !== currentEffectivePlanRevision
    ) {
      throw new Error("PLAN_REVISION_CONFLICT");
    }
  } else if (command.guard.expectedContextRevision !== currentContextRevision) {
    throw new Error("CONTEXT_REVISION_CONFLICT");
  }
  assertCommandInputSchema(
    intervention.inputSchema,
    command.input,
    "INVALID_INTERVENTION_SCHEMA",
    "INVALID_INTERVENTION_INPUT",
  );
}

/** Reject a malformed entry before it can be published or used for a command. */
export function assertBusinessEntryInputSchema(
  schema: Record<string, unknown>,
  errorCode: string,
): void {
  compileBusinessEntryInputSchema(schema, errorCode);
}

/** Validate the persisted entry's payload contract before a command can reserve that entry. */
function assertCommandInputSchema(
  schema: Record<string, unknown>,
  value: unknown,
  schemaError: string,
  inputError: string,
): void {
  const validate = compileBusinessEntryInputSchema(schema, schemaError);
  if (!validate(value)) throw new Error(inputError);
}

// Persisted entries are parsed repeatedly during observation/recovery. Cache only
// JSON schemas by complete content, never by a mutable object or a reused $id.
const entryValidators = new Map<string, ValidateFunction>();
function compileBusinessEntryInputSchema(schema: Record<string, unknown>, errorCode: string) {
  try {
    const serialized = JSON.stringify(schema);
    const copy: unknown = JSON.parse(serialized);
    const cacheable = Buffer.byteLength(serialized) <= 65_536 && isDeepStrictEqual(copy, schema);
    const cached = cacheable ? entryValidators.get(serialized) : undefined;
    if (cached) return cached;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormatsImport.default(ajv);
    // An independent copy prevents later caller mutation from changing a cached
    // validator's referenced enum/const values under an earlier content key.
    const validate = ajv.compile(cacheable ? (copy as Record<string, unknown>) : schema);
    if (cacheable) {
      if (entryValidators.size >= 64) {
        const oldest = entryValidators.keys().next().value;
        if (oldest !== undefined) entryValidators.delete(oldest);
      }
      entryValidators.set(serialized, validate);
    }
    return validate;
  } catch {
    throw new Error(errorCode);
  }
}

export function taskBusinessInteractionJsonSchemas(): Record<string, object> {
  return {
    action: z.toJSONSchema(BusinessActionSchema),
    requiredInput: z.toJSONSchema(RequiredInputSchema),
    intervention: z.toJSONSchema(RuntimeInterventionSchema),
    inputCommand: z.toJSONSchema(RequiredInputResponseCommandSchema),
    interventionCommand: z.toJSONSchema(RuntimeInterventionCommandSchema),
  };
}
