import { isDeepStrictEqual } from "node:util";
import {
  RuntimeBusinessCursorSchema,
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
  parseTaskBusinessFeedbackBody,
  type BusinessObjectRef,
  type RuntimeBusinessCursor,
  type TaskBusinessContext,
  type TaskBusinessFeedbackBody,
} from "../../vehicle-provider-core/src/task-business-contract.js";
import { TaskArtifactSchema } from "../../vehicle-provider-core/src/task-business-artifact.js";
import {
  BusinessActionSchema,
  RequiredInputSchema,
  RuntimeInterventionSchema,
} from "../../vehicle-provider-core/src/task-business-interaction.js";
import type { PublicTaskBusinessFeedback } from "./task-business-feedback.js";

export interface TaskBusinessSnapshotPage {
  contextRevision: number;
  context: unknown;
  objects: unknown[];
  objectDescriptors: unknown[];
  nextCursor?: string;
}

export interface TaskBusinessReducerState {
  context: TaskBusinessContext;
  bootstrapSnapshotRevision: number;
  metadataRevision: number;
  terminalMetadataRevision?: number;
  /** Full immutable values from the snapshot; later events announce newer refs only. */
  objects: ReadonlyMap<string, unknown>;
  /** Exact immutable snapshot versions, including older versions still referenced by Context. */
  objectVersions: ReadonlyMap<string, unknown>;
  objectRevisions: ReadonlyMap<string, number>;
  seenMessageIds: ReadonlySet<string>;
  opaqueDiagnostics: readonly { messageId: string; kind: string; payload: unknown }[];
  /** Latest public cursor seen here; a mixed stream's connection cursor may be farther ahead. */
  resumeFrom: RuntimeBusinessCursor;
}

/** Refs announced by the Context/stream whose exact object bytes are not in this snapshot. */
export function unresolvedTaskBusinessRefs(state: TaskBusinessReducerState): BusinessObjectRef[] {
  const refs = [
    ...state.context.artifactRefs,
    ...state.context.actionRefs,
    ...state.context.requiredInputRefs,
    ...state.context.interventionRefs,
    ...Object.values(state.context.activeRefs),
  ];
  return [...new Map(refs.map((ref) => [`${refKey(ref)}\0${ref.revision}`, ref])).values()].filter(
    (ref) => !state.objectVersions.has(versionKey(ref)),
  );
}

/** All pages must be from one Context revision and contain no unreadable descriptors. */
export function bootstrapTaskBusinessReducer(
  pages: readonly TaskBusinessSnapshotPage[],
  resumeFromValue: unknown,
): TaskBusinessReducerState {
  if (pages.length === 0 || pages.at(-1)?.nextCursor !== undefined) {
    throw new Error("BUSINESS_SNAPSHOT_INCOMPLETE");
  }
  const resumeFrom = RuntimeBusinessCursorSchema.parse(resumeFromValue);
  const first = pages[0];
  if (!first) throw new Error("BUSINESS_SNAPSHOT_INCOMPLETE");
  const context = TaskBusinessContextSchema.parse(first.context);
  const objects = new Map<string, unknown>();
  const objectVersions = new Map<string, unknown>();
  const objectRevisions = new Map<string, number>();
  const expectedVersions = new Set<string>();
  const seenVersions = new Set<string>();
  for (const ref of [
    ...context.artifactRefs,
    ...context.actionRefs,
    ...context.requiredInputRefs,
    ...context.interventionRefs,
    ...Object.values(context.activeRefs),
  ]) {
    const key = refKey(ref);
    objectRevisions.set(key, Math.max(objectRevisions.get(key) ?? 0, ref.revision));
    expectedVersions.add(versionKey(ref));
  }
  for (const [index, page] of pages.entries()) {
    if (index < pages.length - 1 && !page.nextCursor) {
      throw new Error("BUSINESS_SNAPSHOT_INCOMPLETE");
    }
    if (
      page.contextRevision !== context.contextRevision ||
      page.objectDescriptors.length !== 0 ||
      !Array.isArray(page.objects)
    ) {
      throw new Error("BUSINESS_SNAPSHOT_REVISION_CHANGED");
    }
    const pageContext = TaskBusinessContextSchema.parse(page.context);
    if (!isDeepStrictEqual(pageContext, context)) {
      throw new Error("BUSINESS_SNAPSHOT_REVISION_CHANGED");
    }
    for (const value of page.objects) {
      validateSnapshotObject(value, context.identity);
      const ref = objectRef(value);
      const key = refKey(ref);
      const version = versionKey(ref);
      if (!expectedVersions.has(version) || seenVersions.has(version)) {
        throw new Error("BUSINESS_SNAPSHOT_OBJECT_INVALID");
      }
      seenVersions.add(version);
      objectVersions.set(version, value);
      if ((objectRevisions.get(key) ?? 0) <= ref.revision) {
        objectRevisions.set(key, ref.revision);
        objects.set(key, value);
      }
    }
  }
  if (seenVersions.size !== expectedVersions.size) throw new Error("BUSINESS_SNAPSHOT_INCOMPLETE");
  return {
    context,
    bootstrapSnapshotRevision: context.contextRevision,
    metadataRevision: context.contextRevision,
    objects,
    objectVersions,
    objectRevisions,
    seenMessageIds: new Set(),
    opaqueDiagnostics: [],
    resumeFrom,
  };
}

/** Pure read-model update. It never dispatches a Task, Input or device command. */
export function reduceTaskBusinessFeedback(
  previous: TaskBusinessReducerState,
  event: PublicTaskBusinessFeedback,
): TaskBusinessReducerState {
  const eventCursor = RuntimeBusinessCursorSchema.parse(event.resumeFrom);
  const identity = previous.context.identity;
  if (
    event.identity.taskId !== identity.taskId ||
    event.identity.executionId !== identity.executionId ||
    event.identity.providerId !== identity.providerId ||
    event.identity.resourceId !== identity.resourceId ||
    event.identity.operationName !== identity.operationName ||
    (identity.simulationId !== undefined && event.identity.simulationId !== identity.simulationId)
  ) {
    throw new Error("BUSINESS_EVENT_TASK_BINDING_INVALID");
  }
  if (eventCursor.streamId !== previous.resumeFrom.streamId) {
    throw new Error("BUSINESS_EVENT_STREAM_RESET");
  }
  if (previous.seenMessageIds.has(event.messageId)) return previous;
  const seenMessageIds = new Set(previous.seenMessageIds).add(event.messageId);
  const objectRevisions = new Map(previous.objectRevisions);
  const objects = new Map(previous.objects);
  const body = parseTaskBusinessFeedbackBody({
    schemaVersion: event.schemaVersion,
    kind: event.kind,
    contextRevision: event.contextRevision,
    providerRecordedAt: event.providerRecordedAt,
    payload: event.payload,
    ...("required" in event ? { required: event.required } : {}),
  });
  const known = TaskBusinessFeedbackBodySchema.safeParse(body);
  if (
    known.success &&
    known.data.kind === "CONTEXT_FINALIZED" &&
    known.data.payload.finalContextRevision !== event.contextRevision
  ) {
    throw new Error("BUSINESS_EVENT_FINAL_REVISION_INVALID");
  }
  let context = previous.context;
  let metadataRevision = previous.metadataRevision;
  let terminalMetadataRevision = previous.terminalMetadataRevision;
  const shouldApply =
    event.contextRevision > previous.bootstrapSnapshotRevision &&
    event.contextRevision >= previous.context.contextRevision &&
    previous.context.finalizedAt === undefined;
  if (shouldApply && event.contextRevision >= metadataRevision) {
    if (
      known.success &&
      known.data.kind === "BUSINESS_EVENT" &&
      known.data.payload.contextDelta !== undefined
    ) {
      const delta = known.data.payload.contextDelta;
      context = {
        ...context,
        ...(delta.phase === undefined ? {} : { phase: delta.phase }),
        ...(delta.summary === undefined ? {} : { summary: delta.summary }),
        ...(delta.activeRefs === undefined ? {} : { activeRefs: delta.activeRefs }),
        ...(delta.effectivePlanRevision === undefined
          ? {}
          : { effectivePlanRevision: delta.effectivePlanRevision }),
      };
      metadataRevision = event.contextRevision;
      if (delta.summary?.status === "finalized" && delta.phase) {
        terminalMetadataRevision = event.contextRevision;
      }
    }
    if (known.success && known.data.kind === "CONTEXT_FINALIZED") {
      const phase = terminalMetadataRevision === event.contextRevision ? context.phase : null;
      context = {
        ...context,
        phase,
        summary: known.data.payload.summary,
        activeRefs: {},
        artifactRefs: known.data.payload.artifactRefs,
        actionRefs: known.data.payload.actionRefs,
        finalizedAt: known.data.payload.finalizedAt,
      };
      metadataRevision = event.contextRevision;
    }
  }
  if (shouldApply) {
    const ref = known.success ? changedRef(known.data) : undefined;
    if (ref !== undefined) {
      const key = refKey(ref);
      if (ref.revision > (objectRevisions.get(key) ?? 0)) {
        objectRevisions.set(key, ref.revision);
        objects.delete(key);
        if (event.kind === "ARTIFACT_CHANGED")
          context = { ...context, artifactRefs: replaceRef(context.artifactRefs, ref) };
        if (event.kind === "ACTION_CHANGED")
          context = { ...context, actionRefs: replaceRef(context.actionRefs, ref) };
        if (event.kind === "REQUIRED_INPUT_CHANGED")
          context = { ...context, requiredInputRefs: replaceRef(context.requiredInputRefs, ref) };
        if (event.kind === "INTERVENTION_CHANGED")
          context = { ...context, interventionRefs: replaceRef(context.interventionRefs, ref) };
      }
    }
    context = {
      ...context,
      contextRevision: Math.max(context.contextRevision, event.contextRevision),
    };
  }
  const opaqueDiagnostics = !known.success
    ? [
        ...previous.opaqueDiagnostics,
        { messageId: event.messageId, kind: event.kind, payload: event.payload },
      ]
    : previous.opaqueDiagnostics;
  return {
    ...previous,
    resumeFrom:
      BigInt(eventCursor.afterSequence) > BigInt(previous.resumeFrom.afterSequence)
        ? eventCursor
        : previous.resumeFrom,
    context,
    metadataRevision,
    ...(terminalMetadataRevision === undefined ? {} : { terminalMetadataRevision }),
    objectRevisions,
    objects,
    seenMessageIds,
    opaqueDiagnostics,
  };
}

function changedRef(event: TaskBusinessFeedbackBody): BusinessObjectRef | undefined {
  switch (event.kind) {
    case "ARTIFACT_CHANGED":
      return event.payload.artifactRef;
    case "ACTION_CHANGED":
      return event.payload.actionRef;
    case "REQUIRED_INPUT_CHANGED":
      return event.payload.requestRef;
    case "INTERVENTION_CHANGED":
      return event.payload.interventionRef;
    default:
      return undefined;
  }
}

function replaceRef<T extends BusinessObjectRef>(refs: T[], incoming: BusinessObjectRef): T[] {
  return [...refs.filter((ref) => ref.id !== incoming.id), incoming as T];
}

function refKey(ref: BusinessObjectRef): string {
  return `${ref.kind}\0${ref.id}`;
}

function versionKey(ref: BusinessObjectRef): string {
  return `${refKey(ref)}\0${ref.revision}`;
}

function validateSnapshotObject(value: unknown, identity: TaskBusinessContext["identity"]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BUSINESS_SNAPSHOT_OBJECT_INVALID");
  }
  const object = value as Record<string, unknown>;
  const parsed =
    object.kind === "artifact"
      ? TaskArtifactSchema.safeParse(object.value)
      : object.kind === "action"
        ? BusinessActionSchema.safeParse(object.value)
        : object.kind === "input_request"
          ? RequiredInputSchema.safeParse(object.value)
          : object.kind === "intervention"
            ? RuntimeInterventionSchema.safeParse(object.value)
            : undefined;
  if (!parsed?.success) throw new Error("BUSINESS_SNAPSHOT_OBJECT_INVALID");
  const bound = parsed.data.identity;
  if (
    bound.taskId !== identity.taskId ||
    bound.executionId !== identity.executionId ||
    bound.providerId !== identity.providerId ||
    bound.resourceId !== identity.resourceId ||
    bound.operationName !== identity.operationName ||
    bound.simulationId !== identity.simulationId
  ) {
    throw new Error("BUSINESS_SNAPSHOT_OBJECT_INVALID");
  }
}

function objectRef(value: unknown): BusinessObjectRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BUSINESS_SNAPSHOT_OBJECT_INVALID");
  }
  const object = value as Record<string, unknown>;
  const kind = object.kind;
  const body = object.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("BUSINESS_SNAPSHOT_OBJECT_INVALID");
  }
  const item = body as Record<string, unknown>;
  const idField =
    kind === "artifact"
      ? "artifactId"
      : kind === "action"
        ? "actionId"
        : kind === "input_request"
          ? "requestId"
          : kind === "intervention"
            ? "interventionId"
            : undefined;
  const id = idField === undefined ? undefined : item[idField];
  const revision = item.revision;
  if (
    !idField ||
    typeof id !== "string" ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    throw new Error("BUSINESS_SNAPSHOT_OBJECT_INVALID");
  }
  return {
    kind: kind as BusinessObjectRef["kind"],
    id,
    revision,
  };
}
