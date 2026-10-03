import { z } from "zod";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { canonicalJson } from "../../adapter-protocol/src/index.js";
import type { AdapterBusinessEvent } from "../../adapter-protocol/src/index.js";
import type { DeviceExecutionContext } from "../../gowm-shared-storage-adapter/src/device-context.js";
import {
  BusinessObjectRefSchema,
  TaskBusinessContextSchema,
  TaskBusinessIdentitySchema,
  TaskBusinessFeedbackBodySchema,
  type BusinessObjectRef,
  type TaskBusinessContext,
  type TaskBusinessIdentity,
  type TaskBusinessFeedbackBody,
} from "../../vehicle-provider-core/src/task-business-contract.js";
import {
  TaskArtifactSchema,
  type PreparedArtifactContentRead,
  type TaskArtifact,
} from "../../vehicle-provider-core/src/task-business-artifact.js";
import {
  assertBusinessEntryInputSchema,
  assertInterventionAvailableAt,
  assertInterventionTransition,
  assertRequiredInputOpenAt,
  BusinessActionSchema,
  RequiredInputResponseCommandSchema,
  RequiredInputSchema,
  RuntimeInterventionSchema,
  RuntimeInterventionCommandSchema,
  TrustedResponderSchema,
  type BusinessAction,
  type RequiredInput,
  type RuntimeIntervention,
} from "../../vehicle-provider-core/src/task-business-interaction.js";
import type { ProviderExecution } from "./types.js";

/** Construct only from the already admitted Provider execution, never request JSON. */
export class BoundExecutionScope {
  private constructor(
    readonly taskId: string,
    readonly executionId: string,
    readonly providerId: string,
    readonly resourceId: string,
    readonly operationName: string,
    readonly authorizationContextHash: string,
    readonly executionMode: "live" | "simulation",
    readonly simulationId: string,
    readonly correlationId: string,
    readonly deviceContext: DeviceExecutionContext | null,
  ) {
    if (this.deviceContext) Object.freeze(this.deviceContext);
    Object.freeze(this);
  }

  static fromExecution(execution: ProviderExecution): BoundExecutionScope {
    const providerId = execution.providerId;
    const fields = [
      execution.taskId,
      execution.externalExecutionId,
      providerId,
      execution.resourceId,
      execution.operationName,
      execution.executionContext.authorizationContextHash,
    ];
    if (!providerId || fields.some((value) => !value || typeof value !== "string")) {
      throw new Error("BUSINESS_EXECUTION_SCOPE_INCOMPLETE");
    }
    const executionMode = normalizeBusinessExecutionMode(execution.executionContext.executionMode);
    if (
      execution.deviceContext &&
      (execution.deviceContext.providerId !== providerId ||
        execution.deviceContext.resourceId !== execution.resourceId)
    ) {
      throw new Error("BUSINESS_DEVICE_BINDING_MISMATCH");
    }
    if (
      execution.deviceContext &&
      Object.values(execution.deviceContext).some((value) => typeof value !== "string" || !value)
    ) {
      throw new Error("BUSINESS_DEVICE_SCOPE_INCOMPLETE");
    }
    return new BoundExecutionScope(
      execution.taskId,
      execution.externalExecutionId,
      providerId,
      execution.resourceId,
      execution.operationName,
      execution.executionContext.authorizationContextHash,
      executionMode,
      execution.executionContext.simulationId,
      execution.executionContext.correlationId,
      execution.deviceContext ? structuredClone(execution.deviceContext) : null,
    );
  }

  /** Includes device, service, binding, session, authorization, mode and simulation boundary. */
  key(): string {
    const device = this.deviceContext;
    return JSON.stringify([
      this.taskId,
      this.executionId,
      this.providerId,
      this.resourceId,
      this.operationName,
      this.authorizationContextHash,
      this.executionMode,
      this.simulationId,
      this.correlationId,
      device?.deviceId ?? null,
      device?.dataScopeKey ?? null,
      device?.bindingId ?? null,
      device?.smppServiceKey ?? null,
      device?.sourceSessionKey ?? null,
    ]);
  }
}

function normalizeBusinessExecutionMode(value: string): "live" | "simulation" {
  if (value === "live" || value === "LIVE" || value === "1") return "live";
  if (value === "simulation" || value === "SIMULATION" || value === "2") return "simulation";
  throw new Error("BUSINESS_EXECUTION_MODE_INVALID");
}

export function assertBusinessIdentity(
  scope: BoundExecutionScope,
  candidate: TaskBusinessIdentity,
): void {
  assertBoundExecutionScope(scope);
  const identity = TaskBusinessIdentitySchema.parse(candidate);
  if (
    identity.taskId !== scope.taskId ||
    identity.executionId !== scope.executionId ||
    identity.providerId !== scope.providerId ||
    identity.resourceId !== scope.resourceId ||
    identity.operationName !== scope.operationName ||
    (identity.correlationId !== undefined && identity.correlationId !== scope.correlationId) ||
    (identity.simulationId !== undefined && identity.simulationId !== scope.simulationId)
  ) {
    throw new Error("BUSINESS_SCOPE_IDENTITY_MISMATCH");
  }
}

export function assertBoundExecutionScope(scope: BoundExecutionScope): void {
  if (!(scope instanceof BoundExecutionScope)) throw new Error("BUSINESS_SCOPE_NOT_BOUND");
}

export function scopeBusinessIdentity(scope: BoundExecutionScope): TaskBusinessIdentity {
  assertBoundExecutionScope(scope);
  return {
    taskId: scope.taskId,
    executionId: scope.executionId,
    providerId: scope.providerId,
    resourceId: scope.resourceId,
    operationName: scope.operationName,
  };
}

export function contextObjectRefs(context: TaskBusinessContext): BusinessObjectRef[] {
  const values = [
    ...context.artifactRefs,
    ...context.actionRefs,
    ...context.requiredInputRefs,
    ...context.interventionRefs,
    ...Object.values(context.activeRefs),
  ];
  return [
    ...new Map(
      values.map((ref) => [JSON.stringify([ref.kind, ref.id, ref.revision]), ref]),
    ).values(),
  ];
}

/** Check the semantic entry under the same Store fence as a new command claim. */
export function assertBusinessCommandEntryCurrent(
  context: TaskBusinessContext | undefined,
  expected: BusinessObjectRef,
  commandType: "input_response" | "intervention",
): void {
  const ref = BusinessObjectRefSchema.parse(expected);
  if (
    context?.summary.status !== "in_progress" ||
    (commandType === "input_response" && ref.kind !== "input_request") ||
    (commandType === "intervention" && ref.kind !== "intervention")
  )
    throw new Error("BUSINESS_ENTRY_NOT_CURRENT");
  const history =
    ref.kind === "input_request" ? context.requiredInputRefs : context.interventionRefs;
  const latestRevision = history
    .filter((item) => item.id === ref.id)
    .reduce((revision, item) => Math.max(revision, item.revision), 0);
  if (
    latestRevision !== ref.revision ||
    !Object.values(context.activeRefs).some(
      (active) =>
        active.kind === ref.kind && active.id === ref.id && active.revision === ref.revision,
    )
  )
    throw new Error("BUSINESS_ENTRY_NOT_CURRENT");
}

export type BusinessObjectVersion =
  | { kind: "artifact"; value: TaskArtifact }
  | { kind: "action"; value: BusinessAction }
  | { kind: "input_request"; value: RequiredInput }
  | { kind: "intervention"; value: RuntimeIntervention };

/** Rechecked behind the Context/command claim fence, including the entry's time limit. */
export function assertBusinessCommandEntryOpenAt(
  version: BusinessObjectVersion | undefined,
  commandType: "input_response" | "intervention",
  now: Date,
  currentEffectivePlanRevision: number | undefined,
): void {
  if (commandType === "input_response") {
    if (version?.kind !== "input_request") throw new Error("BUSINESS_ENTRY_NOT_CURRENT");
    assertRequiredInputOpenAt(version.value, now);
  } else {
    if (version?.kind !== "intervention") throw new Error("BUSINESS_ENTRY_NOT_CURRENT");
    assertInterventionAvailableAt(version.value, now);
    if (version.value.effectivePlanRevision !== currentEffectivePlanRevision) {
      throw new Error("PLAN_REVISION_CONFLICT");
    }
  }
}

/** Facts produced by accepting an optional Intervention, before any device effect. */
export function prepareInterventionSubmission(
  scope: BoundExecutionScope,
  context: TaskBusinessContext,
  previous: BusinessObjectVersion,
  command: BusinessCommandRecord,
  now: Date,
): {
  context: TaskBusinessContext;
  version: BusinessObjectVersion;
  events: TaskBusinessEventDraft[];
} {
  if (
    command.commandType !== "intervention" ||
    previous.kind !== "intervention" ||
    command.entryKey !== `intervention:${previous.value.interventionId}`
  ) {
    throw new Error("BUSINESS_INTERVENTION_SUBMISSION_INVALID");
  }
  const value = parseBusinessObjectVersion(scope, {
    kind: "intervention",
    value: {
      ...previous.value,
      revision: previous.value.revision + 1,
      state: "submitted",
      acceptedCommandId: command.commandId,
      reasonCode: "INTERVENTION_SUBMITTED",
    },
  });
  if (value.kind !== "intervention") throw new Error("BUSINESS_INTERVENTION_SUBMISSION_INVALID");
  assertInterventionTransition(previous.value, value.value);
  const priorRef = businessObjectRef(previous);
  const ref = {
    kind: "intervention" as const,
    id: value.value.interventionId,
    revision: value.value.revision,
  };
  const activeRefs = Object.fromEntries(
    Object.entries(context.activeRefs).map(([name, active]) => [
      name,
      active.kind === priorRef.kind &&
      active.id === priorRef.id &&
      active.revision === priorRef.revision
        ? ref
        : active,
    ]),
  );
  const recordedAt = new Date(Math.max(now.getTime(), Date.parse(context.updatedAt))).toISOString();
  const next = parseBusinessContext(scope, {
    ...context,
    contextRevision: context.contextRevision + 1,
    activeRefs,
    interventionRefs: context.interventionRefs.map((listed) =>
      listed.kind === priorRef.kind &&
      listed.id === priorRef.id &&
      listed.revision === priorRef.revision
        ? ref
        : listed,
    ),
    updatedAt: recordedAt,
  });
  const reasonCode = "INTERVENTION_SUBMITTED";
  const description = "Intervention command accepted";
  const common = {
    schemaVersion: "sdar.task-business-feedback/1.0-rc2" as const,
    contextRevision: next.contextRevision,
    providerRecordedAt: recordedAt,
  };
  const events: TaskBusinessEventDraft[] = [
    {
      body: {
        ...common,
        kind: "BUSINESS_EVENT",
        payload: {
          eventType: "business.intervention_submitted",
          severity: "info",
          reasonCode,
          description,
          subjects: [ref],
          contextDelta: {
            activeRefs: next.activeRefs,
            effectivePlanRevision: next.effectivePlanRevision,
          },
        },
      },
      description,
      reasonCode,
      severityHint: "info",
    },
    {
      body: {
        ...common,
        kind: "INTERVENTION_CHANGED",
        payload: {
          change: "update",
          interventionRef: ref,
          previousRevision: priorRef.revision,
          reasonCode,
        },
      },
      description,
      reasonCode,
      severityHint: "info",
    },
  ];
  return {
    context: next,
    version: value,
    events: events.map((event) => parseTaskBusinessEventDraft(next, event)),
  };
}

export function parseBusinessObjectVersion(
  scope: BoundExecutionScope,
  candidate: BusinessObjectVersion,
): BusinessObjectVersion {
  let parsed: BusinessObjectVersion;
  switch (candidate.kind) {
    case "artifact":
      parsed = { kind: "artifact", value: TaskArtifactSchema.parse(candidate.value) };
      break;
    case "action":
      parsed = { kind: "action", value: BusinessActionSchema.parse(candidate.value) };
      break;
    case "input_request":
      parsed = { kind: "input_request", value: RequiredInputSchema.parse(candidate.value) };
      assertBusinessEntryInputSchema(parsed.value.inputSchema, "INVALID_INPUT_SCHEMA");
      break;
    case "intervention":
      parsed = { kind: "intervention", value: RuntimeInterventionSchema.parse(candidate.value) };
      assertBusinessEntryInputSchema(parsed.value.inputSchema, "INVALID_INTERVENTION_SCHEMA");
      break;
  }
  assertBusinessIdentity(scope, parsed.value.identity);
  return parsed;
}

export function businessObjectRef(version: BusinessObjectVersion): BusinessObjectRef {
  switch (version.kind) {
    case "artifact":
      return { kind: "artifact", id: version.value.artifactId, revision: version.value.revision };
    case "action":
      return { kind: "action", id: version.value.actionId, revision: version.value.revision };
    case "input_request":
      return {
        kind: "input_request",
        id: version.value.requestId,
        revision: version.value.revision,
      };
    case "intervention":
      return {
        kind: "intervention",
        id: version.value.interventionId,
        revision: version.value.revision,
      };
  }
}

export const BusinessCommandRecordSchema = z
  .object({
    commandId: z.string().min(1).max(256),
    commandType: z.enum(["input_response", "intervention"]),
    entryKey: z.string().min(1).max(256).optional(),
    runtimeCommandSequence: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .optional(),
    /** Original admission provenance; optional for pre-existing ledger records. */
    responder: TrustedResponderSchema.optional(),
    identity: TaskBusinessIdentitySchema,
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    responseHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    /** Persisted only for an admitted input reply, so recovery can replay its effect. */
    inputResponse: RequiredInputResponseCommandSchema.shape.result.optional(),
    /** Admitted semantic request for recovery in the existing command ledger. */
    interventionRequest: RuntimeInterventionCommandSchema.optional(),
    state: z.enum(["accepted", "applied", "rejected"]),
    resultCode: z.string().min(1).max(256).optional(),
    resultRefs: z.array(BusinessObjectRefSchema).optional(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((command, ctx) => {
    if (command.interventionRequest) {
      const request = command.interventionRequest;
      const semantic = Object.fromEntries(
        Object.entries(request).filter(([key]) => key !== "commandId"),
      );
      if (
        command.commandType !== "intervention" ||
        request.commandId !== command.commandId ||
        request.taskId !== command.identity.taskId ||
        request.executionId !== command.identity.executionId ||
        command.entryKey !== `intervention:${request.interventionId}` ||
        createHash("sha256").update(canonicalJson(semantic)).digest("hex") !== command.requestHash
      ) {
        ctx.addIssue({
          code: "custom",
          message: "INTERVENTION_REQUEST_BINDING_INVALID",
          path: ["interventionRequest"],
        });
      }
    }
    if (command.commandType === "input_response" && !command.responseHash) {
      ctx.addIssue({
        code: "custom",
        message: "INPUT_RESPONSE_HASH_REQUIRED",
        path: ["responseHash"],
      });
    }
    if (command.commandType === "intervention" && command.responseHash) {
      ctx.addIssue({
        code: "custom",
        message: "INPUT_RESPONSE_HASH_UNEXPECTED",
        path: ["responseHash"],
      });
    }
    if (command.inputResponse && command.commandType !== "input_response") {
      ctx.addIssue({
        code: "custom",
        message: "INPUT_RESPONSE_ON_NON_INPUT_COMMAND",
        path: ["inputResponse"],
      });
    }
    if (
      command.inputResponse &&
      command.responseHash !== taskBusinessInputResponseHash(command.inputResponse)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "INPUT_RESPONSE_HASH_MISMATCH",
        path: ["inputResponse"],
      });
    }
    if (Date.parse(command.updatedAt) < Date.parse(command.createdAt)) {
      ctx.addIssue({ code: "custom", message: "COMMAND_TIME_ORDER_INVALID", path: ["updatedAt"] });
    }
    if (command.state === "accepted" && (command.resultCode || command.resultRefs)) {
      ctx.addIssue({ code: "custom", message: "ACCEPTED_COMMAND_HAS_RESULT", path: ["state"] });
    }
    if (command.state !== "accepted" && !command.resultCode) {
      ctx.addIssue({
        code: "custom",
        message: "COMMAND_RESULT_CODE_REQUIRED",
        path: ["resultCode"],
      });
    }
  });
export type BusinessCommandRecord = z.infer<typeof BusinessCommandRecordSchema>;

/** Canonical content fingerprint for a reply, independent of its command ID. */
export function taskBusinessInputResponseHash(
  response: NonNullable<RequiredInput["response"]>,
): string {
  return createHash("sha256").update(canonicalJson(response)).digest("hex");
}

export function parseBusinessCommandRecord(
  scope: BoundExecutionScope,
  candidate: BusinessCommandRecord,
): BusinessCommandRecord {
  const command = BusinessCommandRecordSchema.parse(candidate);
  assertBusinessIdentity(scope, command.identity);
  return command;
}

/** A reply fact must resolve the active request that an admitted command reserved. */
export function assertRequiredInputReplyClaim(
  previous: TaskBusinessContext | undefined,
  next: TaskBusinessContext,
  input: RequiredInput,
  claimed: BusinessCommandRecord | undefined,
): void {
  if (
    input.state !== "answered" &&
    input.state !== "declined" &&
    !(input.state === "cancelled" && input.response?.action === "cancel")
  )
    return;
  const priorRef = { kind: "input_request", id: input.requestId, revision: input.revision - 1 };
  const resolvedRef = { kind: "input_request", id: input.requestId, revision: input.revision };
  const sameRef = (ref: BusinessObjectRef): boolean =>
    ref.kind === priorRef.kind && ref.id === priorRef.id && ref.revision === priorRef.revision;
  if (!claimed) throw new Error("BUSINESS_INPUT_RESPONSE_CLAIM_REQUIRED");
  if (
    !previous ||
    !Object.values(previous.activeRefs).some(sameRef) ||
    !next.requiredInputRefs.some(
      (ref) =>
        ref.kind === resolvedRef.kind &&
        ref.id === resolvedRef.id &&
        ref.revision === resolvedRef.revision,
    ) ||
    !input.responseCommandId ||
    claimed.commandId !== input.responseCommandId ||
    claimed.commandType !== "input_response" ||
    claimed.entryKey !== `input:${input.requestKey}`
  ) {
    throw new Error("BUSINESS_INPUT_RESPONSE_CLAIM_REQUIRED");
  }
  if (!input.response || claimed.responseHash !== taskBusinessInputResponseHash(input.response)) {
    throw new Error("BUSINESS_INPUT_RESPONSE_MISMATCH");
  }
}

/** A terminal receipt cannot claim plan application without matching published business facts. */
export function assertInterventionAppliedFacts(
  previous: TaskBusinessContext | undefined,
  next: TaskBusinessContext,
  published: readonly BusinessObjectVersion[],
  command?: BusinessCommandRecord,
): void {
  const appliedObjects = published.filter(
    (item) => item.kind === "intervention" && item.value.state === "applied",
  );
  if (
    appliedObjects.length > 0 &&
    (appliedObjects.length !== 1 ||
      command?.commandType !== "intervention" ||
      command.state !== "applied")
  ) {
    throw new Error("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
  }
  if (command?.commandType !== "intervention" || command.state !== "applied") return;
  const entryId = command.entryKey?.startsWith("intervention:")
    ? command.entryKey.slice("intervention:".length)
    : undefined;
  const intervention = published.find(
    (item) => item.kind === "intervention" && item.value.interventionId === entryId,
  );
  const resultRefs = command.resultRefs ?? [];
  const refKey = (ref: BusinessObjectRef): string =>
    JSON.stringify([ref.kind, ref.id, ref.revision]);
  const resultKeys = resultRefs.map(refKey);
  const interventionKeys =
    intervention?.kind === "intervention" ? (intervention.value.resultRefs ?? []).map(refKey) : [];
  const listed = new Set(contextObjectRefs(next).map(refKey));
  const written = new Set(published.map((item) => refKey(businessObjectRef(item))));
  const planChanging =
    intervention?.kind === "intervention" &&
    intervention.value.interventionType !== "target.change_visual_lock";
  const navigationChanging =
    intervention?.kind === "intervention" &&
    ["navigation.adjust_plan", "navigation.change_destination"].includes(
      intervention.value.interventionType,
    );
  const reconAreaChanging =
    intervention?.kind === "intervention" &&
    intervention.value.interventionType === "recon.adjust_area";
  const activeRoute = next.activeRefs.route;
  const writtenActiveRoute = published.find(
    (item) =>
      item.kind === "artifact" &&
      activeRoute !== undefined &&
      refKey(businessObjectRef(item)) === refKey(activeRoute),
  );
  const adoptedNavigationRoute =
    writtenActiveRoute?.kind === "artifact" &&
    writtenActiveRoute.value.artifactType === "navigation.route" &&
    writtenActiveRoute.value.properties !== undefined &&
    "adoption" in writtenActiveRoute.value.properties &&
    writtenActiveRoute.value.properties.adoption === "adopted" &&
    "purpose" in writtenActiveRoute.value.properties &&
    writtenActiveRoute.value.properties.purpose === "navigation";
  const activeArea = next.activeRefs.reconEffectiveArea;
  const resetCoverage = published.find(
    (item) => item.kind === "artifact" && item.value.artifactId === "recon-covered-area",
  );
  const resetCoverageKey =
    resetCoverage === undefined ? undefined : refKey(businessObjectRef(resetCoverage));
  if (
    !previous ||
    !entryId ||
    intervention?.kind !== "intervention" ||
    intervention.value.state !== "applied" ||
    intervention.value.revision < 2 ||
    intervention.value.acceptedCommandId !== command.commandId ||
    intervention.value.effectivePlanRevision !== previous.effectivePlanRevision ||
    !next.interventionRefs.some((ref) => refKey(ref) === refKey(businessObjectRef(intervention))) ||
    Object.values(next.activeRefs).some(
      (ref) => ref.kind === "intervention" && ref.id === entryId,
    ) ||
    resultKeys.length === 0 ||
    new Set(resultKeys).size !== resultKeys.length ||
    !isDeepStrictEqual(resultKeys.sort(), interventionKeys.sort()) ||
    resultKeys.some((key) => !listed.has(key)) ||
    !resultKeys.some(
      (key) => written.has(key) && key !== refKey(businessObjectRef(intervention)),
    ) ||
    (planChanging && next.effectivePlanRevision !== previous.effectivePlanRevision + 1) ||
    (navigationChanging &&
      (activeRoute?.kind !== "artifact" ||
        refKey(activeRoute) ===
          (previous.activeRefs.route === undefined
            ? undefined
            : refKey(previous.activeRefs.route)) ||
        !resultKeys.includes(refKey(activeRoute)) ||
        !adoptedNavigationRoute)) ||
    (reconAreaChanging &&
      (activeArea?.kind !== "artifact" ||
        refKey(activeArea) ===
          (previous.activeRefs.reconEffectiveArea === undefined
            ? undefined
            : refKey(previous.activeRefs.reconEffectiveArea)) ||
        !resultKeys.includes(refKey(activeArea)) ||
        resetCoverageKey === undefined ||
        !resultKeys.includes(resetCoverageKey)))
  ) {
    throw new Error("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
  }
}

/** A claimed adjustment cannot fail silently or switch the effective plan on rejection. */
export function assertInterventionRejectedFacts(
  previous: TaskBusinessContext | undefined,
  next: TaskBusinessContext,
  published: readonly BusinessObjectVersion[],
  command?: BusinessCommandRecord,
): void {
  const rejectedObjects = published.filter(
    (item) =>
      item.kind === "intervention" &&
      item.value.acceptedCommandId !== undefined &&
      (item.value.state === "failed" || item.value.state === "withdrawn"),
  );
  if (
    rejectedObjects.length > 0 &&
    (rejectedObjects.length !== 1 ||
      command?.commandType !== "intervention" ||
      command.state !== "rejected")
  ) {
    throw new Error("BUSINESS_INTERVENTION_REJECTED_FACTS_INCOMPLETE");
  }
  if (command?.commandType !== "intervention" || command.state !== "rejected") return;
  const entryId = command.entryKey?.startsWith("intervention:")
    ? command.entryKey.slice("intervention:".length)
    : undefined;
  const intervention = rejectedObjects.find(
    (item) => item.kind === "intervention" && item.value.interventionId === entryId,
  );
  const refKey = (ref: BusinessObjectRef): string =>
    JSON.stringify([ref.kind, ref.id, ref.revision]);
  const resultKeys = (command.resultRefs ?? []).map(refKey);
  const interventionKeys =
    intervention?.kind === "intervention" ? (intervention.value.resultRefs ?? []).map(refKey) : [];
  const listed = new Set(contextObjectRefs(next).map(refKey));
  const navigationChanging =
    intervention?.kind === "intervention" &&
    ["navigation.adjust_plan", "navigation.change_destination"].includes(
      intervention.value.interventionType,
    );
  const reconAreaChanging =
    intervention?.kind === "intervention" &&
    intervention.value.interventionType === "recon.adjust_area";
  if (
    !previous ||
    !entryId ||
    intervention?.kind !== "intervention" ||
    intervention.value.revision < 2 ||
    intervention.value.acceptedCommandId !== command.commandId ||
    intervention.value.effectivePlanRevision !== previous.effectivePlanRevision ||
    next.effectivePlanRevision !== previous.effectivePlanRevision ||
    !next.interventionRefs.some((ref) => refKey(ref) === refKey(businessObjectRef(intervention))) ||
    Object.values(next.activeRefs).some(
      (ref) => ref.kind === "intervention" && ref.id === entryId,
    ) ||
    new Set(resultKeys).size !== resultKeys.length ||
    !isDeepStrictEqual(resultKeys.sort(), interventionKeys.sort()) ||
    resultKeys.some((key) => !listed.has(key)) ||
    (navigationChanging &&
      next.summary.status === "in_progress" &&
      !isDeepStrictEqual(next.activeRefs.route, previous.activeRefs.route)) ||
    (reconAreaChanging &&
      !isDeepStrictEqual(
        next.activeRefs.reconEffectiveArea,
        previous.activeRefs.reconEffectiveArea,
      ))
  ) {
    throw new Error("BUSINESS_INTERVENTION_REJECTED_FACTS_INCOMPLETE");
  }
}

export interface BusinessChangeSet {
  scope: BoundExecutionScope;
  /** null creates a Context; otherwise compare-and-swap its exact revision. */
  expectedContextRevision: number | null;
  context: TaskBusinessContext;
  objects: readonly BusinessObjectVersion[];
  /** Bytes for every new content_ref on an Artifact version in this changeset. */
  contents?: readonly BusinessContentWrite[];
  /** Terminal result of a previously claimed command, saved with the object changes. */
  command?: BusinessCommandRecord;
}

export interface BusinessContentWrite {
  artifactId: string;
  revision: number;
  handle: string;
  bytes: Uint8Array;
}

export interface StoredBusinessContent extends BusinessContentWrite {
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  expiresAt?: string;
}

export function validateBusinessContentWrites(
  changeSet: BusinessChangeSet,
): StoredBusinessContent[] {
  const required = new Map<string, Omit<StoredBusinessContent, "bytes">>();
  for (const version of changeSet.objects) {
    if (version.kind !== "artifact" || version.value.availability !== "available") continue;
    const artifact = version.value;
    for (const content of [artifact.content, ...Object.values(artifact.representations ?? {})]) {
      if (content.kind !== "content_ref") continue;
      const existing = required.get(content.handle);
      const expected = {
        artifactId: artifact.artifactId,
        revision: artifact.revision,
        handle: content.handle,
        mediaType: content.mediaType,
        sizeBytes: content.sizeBytes,
        sha256: content.sha256,
        ...(content.expiresAt === undefined ? {} : { expiresAt: content.expiresAt }),
      };
      if (existing && JSON.stringify(existing) !== JSON.stringify(expected)) {
        throw new Error("ARTIFACT_CONTENT_HANDLE_CONFLICT");
      }
      required.set(content.handle, expected);
    }
  }
  const seen = new Set<string>();
  const prepared: StoredBusinessContent[] = [];
  for (const write of changeSet.contents ?? []) {
    const expected = required.get(write.handle);
    if (expected?.artifactId !== write.artifactId || expected.revision !== write.revision) {
      throw new Error("ARTIFACT_CONTENT_UNREFERENCED");
    }
    if (seen.has(write.handle)) throw new Error("ARTIFACT_CONTENT_DUPLICATE");
    seen.add(write.handle);
    if (!(write.bytes instanceof Uint8Array)) throw new Error("ARTIFACT_CONTENT_BYTES_INVALID");
    const bytes = Uint8Array.from(write.bytes);
    if (bytes.length !== expected.sizeBytes) throw new Error("ARTIFACT_CONTENT_SIZE_MISMATCH");
    if (createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
      throw new Error("ARTIFACT_CONTENT_HASH_MISMATCH");
    }
    if (expected.mediaType.includes("json")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
      } catch {
        throw new Error("ARTIFACT_CONTENT_JSON_INVALID");
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        "kind" in parsed &&
        parsed.kind === "content_ref"
      ) {
        throw new Error("ARTIFACT_CONTENT_RECURSIVE_REF");
      }
    }
    prepared.push({ ...expected, bytes });
  }
  if (seen.size !== required.size) throw new Error("ARTIFACT_CONTENT_BYTES_REQUIRED");
  return prepared;
}

export interface TaskBusinessEventDraft {
  body: TaskBusinessFeedbackBody;
  description: string;
  reasonCode: string;
  severityHint: "info" | "warning" | "critical";
}

export interface CommittedBusinessChangeSet {
  context: TaskBusinessContext;
  events: AdapterBusinessEvent[];
}

export function parseTaskBusinessEventDraft(
  context: TaskBusinessContext,
  candidate: TaskBusinessEventDraft,
): TaskBusinessEventDraft {
  const body = TaskBusinessFeedbackBodySchema.parse(candidate.body);
  if (body.contextRevision !== context.contextRevision) {
    throw new Error("BUSINESS_EVENT_CONTEXT_REVISION_MISMATCH");
  }
  if (body.kind === "CONTEXT_FINALIZED") {
    if (
      context.summary.status !== "finalized" ||
      body.payload.finalContextRevision !== context.contextRevision ||
      !isDeepStrictEqual(body.payload.summary, context.summary) ||
      !isDeepStrictEqual(body.payload.artifactRefs, context.artifactRefs) ||
      !isDeepStrictEqual(body.payload.actionRefs, context.actionRefs) ||
      body.payload.finalizedAt !== context.finalizedAt
    ) {
      throw new Error("BUSINESS_EVENT_FINALIZATION_MISMATCH");
    }
  }
  if (
    !candidate.description ||
    !candidate.reasonCode ||
    !["info", "warning", "critical"].includes(candidate.severityHint)
  ) {
    throw new Error("BUSINESS_EVENT_DRAFT_INVALID");
  }
  return { ...candidate, body };
}

/** A terminal adjustment must be discoverable from its committed public source boundary. */
export function assertInterventionTerminalPublicEvents(
  context: TaskBusinessContext,
  published: readonly BusinessObjectVersion[],
  command: BusinessCommandRecord | undefined,
  events: readonly TaskBusinessEventDraft[],
): void {
  if (command?.commandType !== "intervention" || command.state === "accepted") return;
  const refKey = (ref: BusinessObjectRef): string =>
    JSON.stringify([ref.kind, ref.id, ref.revision]);
  const terminal = published.find(
    (item) =>
      item.kind === "intervention" &&
      item.value.acceptedCommandId === command.commandId &&
      (command.state === "applied"
        ? item.value.state === "applied"
        : item.value.state === "failed" || item.value.state === "withdrawn"),
  );
  if (terminal?.kind !== "intervention") {
    throw new Error("BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED");
  }
  const terminalKey = refKey(businessObjectRef(terminal));
  const interventionEvents = events.filter(
    ({ body }) =>
      body.kind === "INTERVENTION_CHANGED" && refKey(body.payload.interventionRef) === terminalKey,
  );
  const interventionEvent =
    interventionEvents.length === 1 &&
    interventionEvents[0]?.body.kind === "INTERVENTION_CHANGED" &&
    interventionEvents[0].body.payload.change === "update" &&
    interventionEvents[0].body.payload.previousRevision === terminal.value.revision - 1;
  const metadataEvent = events.some(
    ({ body }) =>
      body.kind === "BUSINESS_EVENT" &&
      body.payload.contextDelta?.effectivePlanRevision === context.effectivePlanRevision &&
      isDeepStrictEqual(body.payload.contextDelta.activeRefs, context.activeRefs),
  );
  const resultKeys = new Set((command.resultRefs ?? []).map(refKey));
  const resultEvents = published
    .filter((item) => resultKeys.has(refKey(businessObjectRef(item))))
    .every((item) => {
      const key = refKey(businessObjectRef(item));
      return events.some(({ body }) => {
        switch (item.kind) {
          case "artifact":
            return body.kind === "ARTIFACT_CHANGED" && refKey(body.payload.artifactRef) === key;
          case "action":
            return body.kind === "ACTION_CHANGED" && refKey(body.payload.actionRef) === key;
          case "input_request":
            return (
              body.kind === "REQUIRED_INPUT_CHANGED" && refKey(body.payload.requestRef) === key
            );
          case "intervention":
            return (
              body.kind === "INTERVENTION_CHANGED" && refKey(body.payload.interventionRef) === key
            );
        }
      });
    });
  if (!interventionEvent || !metadataEvent || !resultEvents) {
    throw new Error("BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED");
  }
}

/** Switching a recon area must retire the old coverage basis in the same public change. */
export function assertReconAreaAdoptionFacts(
  previous: TaskBusinessContext | undefined,
  next: TaskBusinessContext,
  published: readonly BusinessObjectVersion[],
  events: readonly TaskBusinessEventDraft[],
  previousEffectiveArea?: BusinessObjectVersion,
): void {
  const ref = next.activeRefs.reconEffectiveArea;
  if (isDeepStrictEqual(ref, previous?.activeRefs.reconEffectiveArea)) return;
  if (!ref) throw new Error("RECON_EFFECTIVE_AREA_REF_REMOVED");
  const area = published.find(
    (version) =>
      version.kind === "artifact" &&
      version.value.artifactId === ref.id &&
      version.value.revision === ref.revision,
  );
  const reset = published.find(
    (version) => version.kind === "artifact" && version.value.artifactId === "recon-covered-area",
  );
  const resetRef =
    reset?.kind === "artifact"
      ? { kind: "artifact" as const, id: reset.value.artifactId, revision: reset.value.revision }
      : undefined;
  const properties = next.summary.properties ?? {};
  if (
    !previous ||
    ref.kind !== "artifact" ||
    ref.id !== "recon-requested-area" ||
    area?.kind !== "artifact" ||
    area.value.artifactType !== "recon.area" ||
    area.value.semantics !== "planned" ||
    area.value.availability !== "available" ||
    reset?.kind !== "artifact" ||
    reset.value.artifactType !== "recon.covered_area" ||
    reset.value.availability !== "not_produced_yet" ||
    reset.value.reasonCode !== "COVERAGE_RESET_FOR_NEW_AREA" ||
    Date.parse(reset.value.updatedAt) < Date.parse(area.value.updatedAt) ||
    Date.parse(next.updatedAt) < Date.parse(reset.value.updatedAt) ||
    next.effectivePlanRevision !== previous.effectivePlanRevision + 1 ||
    !next.artifactRefs.some((listed) => isDeepStrictEqual(listed, ref)) ||
    !next.artifactRefs.some((listed) => isDeepStrictEqual(listed, resetRef)) ||
    [
      "reconCoverage",
      "reconCoverageCursorHash",
      "reconCoverageSignature",
      "reconCoverageMissionId",
    ].some((key) => Object.hasOwn(properties, key))
  ) {
    throw new Error("RECON_AREA_ADOPTION_FACTS_INCOMPLETE");
  }
  if (previous.activeRefs.reconEffectiveArea && !previousEffectiveArea) {
    throw new Error("RECON_PREVIOUS_EFFECTIVE_AREA_INVALID");
  }
  const previousRevision =
    previousEffectiveArea?.kind === "artifact" &&
    previousEffectiveArea.value.artifactType === "recon.area" &&
    previousEffectiveArea.value.availability === "available" &&
    "areaRevision" in previousEffectiveArea.value.properties
      ? previousEffectiveArea.value.properties.areaRevision
      : undefined;
  if (
    previousEffectiveArea &&
    (typeof previousRevision !== "number" ||
      !Number.isInteger(previousRevision) ||
      previousRevision < 1)
  ) {
    throw new Error("RECON_PREVIOUS_EFFECTIVE_AREA_INVALID");
  }
  const nextRevision =
    "areaRevision" in area.value.properties ? area.value.properties.areaRevision : undefined;
  if (
    typeof nextRevision !== "number" ||
    !Number.isInteger(nextRevision) ||
    nextRevision < 1 ||
    (previousRevision !== undefined && nextRevision <= previousRevision)
  ) {
    throw new Error("RECON_AREA_REVISION_NOT_ADVANCED");
  }
  if (next.activeRefs.currentFootprint !== undefined) {
    throw new Error("RECON_AREA_ADOPTION_FOOTPRINT_STALE");
  }
  const changed = (target: BusinessObjectRef): boolean =>
    events.some(
      ({ body }) =>
        body.kind === "ARTIFACT_CHANGED" &&
        body.payload.change === "update" &&
        body.payload.previousRevision === target.revision - 1 &&
        isDeepStrictEqual(body.payload.artifactRef, target),
    );
  if (
    !resetRef ||
    !changed(ref) ||
    !changed(resetRef) ||
    !events.some(
      ({ body }) =>
        body.kind === "BUSINESS_EVENT" &&
        isDeepStrictEqual(body.payload.contextDelta?.activeRefs, next.activeRefs) &&
        body.payload.contextDelta?.effectivePlanRevision === next.effectivePlanRevision &&
        isDeepStrictEqual(body.payload.contextDelta.summary, next.summary),
    )
  ) {
    throw new Error("RECON_AREA_ADOPTION_PUBLIC_EVENTS_REQUIRED");
  }
}

/** Keep the original helper name for existing callers of the shared kit. */
export const assertInterventionAppliedPublicEvents = assertInterventionTerminalPublicEvents;

export interface TaskBusinessSnapshot {
  context: TaskBusinessContext;
  /** Exact immutable versions named by the Context at the read boundary. */
  objects: BusinessObjectVersion[];
}

export interface TaskBusinessSnapshotPage {
  contextRevision: number;
  context?: TaskBusinessContext;
  contextDescriptor?: { revision: number; sizeBytes: number; readMethod: "getContext" };
  objects: BusinessObjectVersion[];
  objectDescriptors: {
    ref: BusinessObjectRef;
    sizeBytes: number;
    readMethod: "getObjectVersion";
  }[];
  nextCursor?: string;
}

/** A cursor is bound to scope and Context revision; immutable versions are read exactly. */
export async function loadTaskBusinessSnapshotPage(
  store: Pick<TaskBusinessStore, "getContext" | "getObjectVersion">,
  scope: BoundExecutionScope,
  maxBytes: number,
  cursor?: string,
): Promise<TaskBusinessSnapshotPage | undefined> {
  assertBoundExecutionScope(scope);
  if (!Number.isInteger(maxBytes) || maxBytes < 1_024 || maxBytes > 1_048_576) {
    throw new Error("BUSINESS_SNAPSHOT_PAGE_LIMIT_INVALID");
  }
  const context = await store.getContext(scope);
  if (!context) return undefined;
  const refs = contextObjectRefs(context);
  const scopeHash = createHash("sha256").update(scope.key()).digest("hex");
  let index = 0;
  if (cursor) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    } catch {
      throw new Error("BUSINESS_SNAPSHOT_CURSOR_INVALID");
    }
    if (!decoded || typeof decoded !== "object")
      throw new Error("BUSINESS_SNAPSHOT_CURSOR_INVALID");
    const fields = decoded as Record<string, unknown>;
    if (
      fields.scopeHash !== scopeHash ||
      fields.contextRevision !== context.contextRevision ||
      typeof fields.index !== "number" ||
      !Number.isInteger(fields.index) ||
      fields.index < 0 ||
      fields.index > refs.length
    ) {
      throw new Error("BUSINESS_SNAPSHOT_REVISION_CHANGED");
    }
    index = fields.index;
  }
  const cursorFor = (offset: number): string =>
    Buffer.from(
      JSON.stringify({ scopeHash, contextRevision: context.contextRevision, index: offset }),
    ).toString("base64url");
  const contextSize = Buffer.byteLength(JSON.stringify(context));
  const page: TaskBusinessSnapshotPage = {
    contextRevision: context.contextRevision,
    ...(contextSize <= maxBytes / 2
      ? { context }
      : {
          contextDescriptor: {
            revision: context.contextRevision,
            sizeBytes: contextSize,
            readMethod: "getContext",
          } as const,
        }),
    objects: [],
    objectDescriptors: [],
  };
  const fits = (offset: number): boolean =>
    Buffer.byteLength(
      JSON.stringify({
        ...page,
        ...(offset < refs.length ? { nextCursor: cursorFor(offset) } : {}),
      }),
    ) <= maxBytes;
  if (!fits(index)) throw new Error("BUSINESS_SNAPSHOT_PAGE_LIMIT_TOO_SMALL");
  for (; index < refs.length; index += 1) {
    const ref = refs[index];
    if (!ref) throw new Error("BUSINESS_SNAPSHOT_REF_INVALID");
    const object = await store.getObjectVersion(scope, ref);
    if (!object) throw new Error("BUSINESS_CONTEXT_REF_NOT_FOUND");
    const objectSize = Buffer.byteLength(JSON.stringify(object));
    if (objectSize <= maxBytes) {
      page.objects.push(object);
      if (fits(index + 1)) continue;
      page.objects.pop();
    }
    if (page.objects.length > 0 || page.objectDescriptors.length > 0) break;
    page.objectDescriptors.push({ ref, sizeBytes: objectSize, readMethod: "getObjectVersion" });
    if (!fits(index + 1)) throw new Error("BUSINESS_SNAPSHOT_PAGE_LIMIT_TOO_SMALL");
  }
  const latest = await store.getContext(scope);
  if (latest?.contextRevision !== context.contextRevision) {
    throw new Error("BUSINESS_SNAPSHOT_REVISION_CHANGED");
  }
  if (index < refs.length) {
    page.nextCursor = cursorFor(index);
  }
  return page;
}

/** Same observable port for Memory and the native/shared PostgreSQL implementations. */
export interface TaskBusinessStore {
  getContext(scope: BoundExecutionScope): Promise<TaskBusinessContext | undefined>;
  getContextSnapshot(scope: BoundExecutionScope): Promise<TaskBusinessSnapshot | undefined>;
  getContextSnapshotPage(
    scope: BoundExecutionScope,
    maxBytes: number,
    cursor?: string,
  ): Promise<TaskBusinessSnapshotPage | undefined>;
  getArtifactVersion(
    scope: BoundExecutionScope,
    artifactId: string,
    revision: number,
  ): Promise<TaskArtifact | undefined>;
  getArtifactLatest(
    scope: BoundExecutionScope,
    artifactId: string,
  ): Promise<TaskArtifact | undefined>;
  readArtifactContent(
    scope: BoundExecutionScope,
    artifactId: string,
    revision: number,
    now: Date,
    representationName?: string,
  ): Promise<PreparedArtifactContentRead>;
  readArtifactContentBytes(
    scope: BoundExecutionScope,
    artifactId: string,
    revision: number,
    now: Date,
    representationName?: string,
  ): Promise<StoredBusinessContent>;
  getObjectVersion(
    scope: BoundExecutionScope,
    ref: BusinessObjectRef,
  ): Promise<BusinessObjectVersion | undefined>;
  getCommand(
    scope: BoundExecutionScope,
    commandId: string,
  ): Promise<BusinessCommandRecord | undefined>;
  /** The unique accepted reply for a pending input, if one was claimed. */
  getAcceptedInputCommand(
    scope: BoundExecutionScope,
    requestKey: string,
  ): Promise<BusinessCommandRecord | undefined>;
  claimCommand(
    scope: BoundExecutionScope,
    command: BusinessCommandRecord,
    expectedEntryRef?: BusinessObjectRef,
    now?: Date,
    expectedContextRevision?: number,
    options?: { publishInterventionSubmission: true },
  ): Promise<BusinessCommandClaim>;
  commitChangeSet(changeSet: BusinessChangeSet): Promise<TaskBusinessContext>;
  commitBusinessChangeSet(
    changeSet: BusinessChangeSet,
    events: readonly TaskBusinessEventDraft[],
  ): Promise<CommittedBusinessChangeSet>;
}

export interface BusinessCommandClaim {
  claimed: boolean;
  record: BusinessCommandRecord;
  /** Present only when this new claim atomically published an Intervention submission. */
  events?: AdapterBusinessEvent[];
}

export function parseBusinessContext(
  scope: BoundExecutionScope,
  candidate: TaskBusinessContext,
): TaskBusinessContext {
  const context = TaskBusinessContextSchema.parse(candidate);
  assertBusinessIdentity(scope, context.identity);
  if (context.summary.status === "finalized") {
    if (!context.finalizedAt || Object.keys(context.activeRefs).length > 0) {
      throw new Error("BUSINESS_CONTEXT_FINALIZATION_INVALID");
    }
  } else if (context.finalizedAt) {
    throw new Error("BUSINESS_CONTEXT_FINALIZATION_INVALID");
  }
  return context;
}

/** Context revision time is a scope-wide high-water mark, not one source's capture time. */
export function assertBusinessContextTimeProgression(
  current: TaskBusinessContext | undefined,
  next: TaskBusinessContext,
): void {
  if (current && Date.parse(next.updatedAt) < Date.parse(current.updatedAt)) {
    throw new Error("BUSINESS_CONTEXT_TIME_REGRESSION");
  }
}
