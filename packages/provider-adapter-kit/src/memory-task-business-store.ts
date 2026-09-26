import {
  assertActionTransition,
  assertInterventionTransition,
  assertRequiredInputTransition,
} from "../../vehicle-provider-core/src/task-business-interaction.js";
import {
  BusinessObjectRefSchema,
  type BusinessObjectRef,
  type TaskBusinessContext,
} from "../../vehicle-provider-core/src/task-business-contract.js";
import {
  prepareArtifactContentRead,
  type PreparedArtifactContentRead,
  type TaskArtifact,
} from "../../vehicle-provider-core/src/task-business-artifact.js";
import {
  assertBoundExecutionScope,
  assertBusinessCommandEntryCurrent,
  assertBusinessCommandEntryOpenAt,
  assertBusinessContextTimeProgression,
  assertInterventionAppliedFacts,
  assertInterventionRejectedFacts,
  assertInterventionTerminalPublicEvents,
  assertReconAreaAdoptionFacts,
  assertRequiredInputReplyClaim,
  businessObjectRef,
  contextObjectRefs,
  parseBusinessCommandRecord,
  parseBusinessContext,
  parseBusinessObjectVersion,
  parseTaskBusinessEventDraft,
  prepareInterventionSubmission,
  validateBusinessContentWrites,
  loadTaskBusinessSnapshotPage,
  scopeBusinessIdentity,
  type BoundExecutionScope,
  type BusinessChangeSet,
  type BusinessCommandRecord,
  type BusinessCommandClaim,
  type BusinessObjectVersion,
  type CommittedBusinessChangeSet,
  type TaskBusinessEventDraft,
  type TaskBusinessStore,
  type TaskBusinessSnapshot,
  type TaskBusinessSnapshotPage,
  type StoredBusinessContent,
} from "./task-business-store.js";
import { taskBusinessSourceCapability } from "./sources.js";

interface ScopeState {
  context?: TaskBusinessContext;
  versions: Map<string, Map<number, BusinessObjectVersion>>;
  latest: Map<string, number>;
  commands: Map<string, BusinessCommandRecord>;
  contents: Map<string, StoredBusinessContent>;
}

const emptyState = (): ScopeState => ({
  versions: new Map(),
  latest: new Map(),
  commands: new Map(),
  contents: new Map(),
});
const objectKey = (ref: Pick<BusinessObjectRef, "kind" | "id">): string =>
  JSON.stringify([ref.kind, ref.id]);

/** In-process adapter for component tests and explicitly selected non-live use. */
export class MemoryTaskBusinessStore implements TaskBusinessStore {
  readonly #scopes = new Map<string, ScopeState>();
  readonly #businessEvents: AdapterBusinessEvent[] = [];

  getContext(scope: BoundExecutionScope): Promise<TaskBusinessContext | undefined> {
    assertBoundExecutionScope(scope);
    const value = this.#scopes.get(scope.key())?.context;
    return Promise.resolve(value ? structuredClone(value) : undefined);
  }

  getContextSnapshot(scope: BoundExecutionScope): Promise<TaskBusinessSnapshot | undefined> {
    return Promise.resolve().then(() => {
      assertBoundExecutionScope(scope);
      const state = this.#scopes.get(scope.key());
      const context = state?.context;
      if (!context) return undefined;
      const objects = contextObjectRefs(context).map((ref) => {
        const value = state.versions.get(objectKey(ref))?.get(ref.revision);
        if (!value) throw new Error("BUSINESS_CONTEXT_REF_NOT_FOUND");
        return structuredClone(value);
      });
      const snapshot = { context: structuredClone(context), objects };
      if (Buffer.byteLength(JSON.stringify(snapshot)) > 1_048_576) {
        throw new Error("BUSINESS_SNAPSHOT_TOO_LARGE");
      }
      return snapshot;
    });
  }

  getContextSnapshotPage(
    scope: BoundExecutionScope,
    maxBytes: number,
    cursor?: string,
  ): Promise<TaskBusinessSnapshotPage | undefined> {
    return loadTaskBusinessSnapshotPage(this, scope, maxBytes, cursor);
  }

  getArtifactVersion(
    scope: BoundExecutionScope,
    artifactId: string,
    revision: number,
  ): Promise<TaskArtifact | undefined> {
    return this.getObjectVersion(scope, { kind: "artifact", id: artifactId, revision }).then(
      (version) => (version?.kind === "artifact" ? version.value : undefined),
    );
  }

  getArtifactLatest(
    scope: BoundExecutionScope,
    artifactId: string,
  ): Promise<TaskArtifact | undefined> {
    assertBoundExecutionScope(scope);
    const state = this.#scopes.get(scope.key());
    const revision = state?.latest.get(objectKey({ kind: "artifact", id: artifactId }));
    return revision === undefined
      ? Promise.resolve(undefined)
      : this.getArtifactVersion(scope, artifactId, revision);
  }

  async readArtifactContent(
    scope: BoundExecutionScope,
    artifactId: string,
    revision: number,
    now: Date,
    representationName?: string,
  ): Promise<PreparedArtifactContentRead> {
    const artifact = await this.getArtifactVersion(scope, artifactId, revision);
    if (!artifact) throw new Error("ARTIFACT_REVISION_NOT_FOUND");
    return prepareArtifactContentRead(
      artifact,
      { identity: scopeBusinessIdentity(scope), artifactId, revision },
      now,
      representationName,
    );
  }

  async readArtifactContentBytes(
    scope: BoundExecutionScope,
    artifactId: string,
    revision: number,
    now: Date,
    representationName?: string,
  ): Promise<StoredBusinessContent> {
    const prepared = await this.readArtifactContent(
      scope,
      artifactId,
      revision,
      now,
      representationName,
    );
    if (prepared.kind !== "stored") throw new Error("ARTIFACT_CONTENT_INLINE");
    const content = this.#scopes.get(scope.key())?.contents.get(prepared.handle);
    if (content?.artifactId !== artifactId || content.revision !== revision) {
      throw new Error("ARTIFACT_CONTENT_NOT_FOUND");
    }
    if (
      content.sha256 !== prepared.sha256 ||
      content.sizeBytes !== prepared.sizeBytes ||
      content.bytes.length !== prepared.sizeBytes ||
      createHash("sha256").update(content.bytes).digest("hex") !== prepared.sha256
    ) {
      throw new Error("ARTIFACT_CONTENT_HASH_MISMATCH");
    }
    return { ...content, bytes: Uint8Array.from(content.bytes) };
  }

  getObjectVersion(
    scope: BoundExecutionScope,
    ref: BusinessObjectRef,
  ): Promise<BusinessObjectVersion | undefined> {
    assertBoundExecutionScope(scope);
    const exactRef = BusinessObjectRefSchema.parse(ref);
    const value = this.#scopes
      .get(scope.key())
      ?.versions.get(objectKey(exactRef))
      ?.get(exactRef.revision);
    return Promise.resolve(value ? structuredClone(value) : undefined);
  }

  getCommand(
    scope: BoundExecutionScope,
    commandId: string,
  ): Promise<BusinessCommandRecord | undefined> {
    assertBoundExecutionScope(scope);
    const value = this.#scopes.get(scope.key())?.commands.get(commandId);
    return Promise.resolve(value ? structuredClone(value) : undefined);
  }

  claimCommand(
    scope: BoundExecutionScope,
    candidate: BusinessCommandRecord,
    expectedEntryRef?: BusinessObjectRef,
    now: Date = new Date(),
    expectedContextRevision?: number,
    options?: { publishInterventionSubmission: true },
  ): Promise<BusinessCommandClaim> {
    return Promise.resolve().then(() => {
      assertBoundExecutionScope(scope);
      const command = parseBusinessCommandRecord(scope, candidate);
      if (command.state !== "accepted") throw new Error("BUSINESS_COMMAND_CLAIM_STATE_INVALID");
      const state = this.#scopes.get(scope.key()) ?? emptyState();
      const existing = state.commands.get(command.commandId);
      if (existing) {
        if (
          existing.commandType !== command.commandType ||
          existing.requestHash !== command.requestHash ||
          existing.responseHash !== command.responseHash ||
          existing.entryKey !== command.entryKey ||
          existing.runtimeCommandSequence !== command.runtimeCommandSequence
        ) {
          throw new Error("COMMAND_ID_CONFLICT");
        }
        return { claimed: false, record: structuredClone(existing) };
      }
      if (
        expectedContextRevision !== undefined &&
        state.context?.contextRevision !== expectedContextRevision
      ) {
        throw new Error("CONTEXT_REVISION_CONFLICT");
      }
      if (expectedEntryRef) {
        assertBusinessCommandEntryCurrent(state.context, expectedEntryRef, command.commandType);
        const version = state.versions
          .get(objectKey(expectedEntryRef))
          ?.get(expectedEntryRef.revision);
        assertBusinessCommandEntryOpenAt(
          version,
          command.commandType,
          now,
          state.context?.effectivePlanRevision,
        );
      }
      for (const other of state.commands.values()) {
        if (
          command.entryKey &&
          other.entryKey === command.entryKey &&
          (other.state === "accepted" || other.state === "applied")
        ) {
          throw new Error("BUSINESS_ENTRY_ALREADY_CLAIMED");
        }
        if (
          command.commandType === "intervention" &&
          other.commandType === "intervention" &&
          other.state === "accepted"
        ) {
          throw new Error("BUSINESS_CHANGE_IN_PROGRESS");
        }
        if (
          command.runtimeCommandSequence &&
          other.commandType === command.commandType &&
          other.runtimeCommandSequence === command.runtimeCommandSequence
        ) {
          throw new Error("RUNTIME_COMMAND_SEQUENCE_CONFLICT");
        }
      }
      const staged: ScopeState = {
        ...(state.context ? { context: state.context } : {}),
        versions: new Map(state.versions),
        latest: new Map(state.latest),
        commands: new Map(state.commands),
        contents: state.contents,
      };
      let events: AdapterBusinessEvent[] | undefined;
      if (options?.publishInterventionSubmission) {
        if (!expectedEntryRef || !state.context) {
          throw new Error("BUSINESS_INTERVENTION_SUBMISSION_INVALID");
        }
        const previous = state.versions
          .get(objectKey(expectedEntryRef))
          ?.get(expectedEntryRef.revision);
        if (
          !previous ||
          state.latest.get(objectKey(expectedEntryRef)) !== expectedEntryRef.revision
        ) {
          throw new Error("BUSINESS_ENTRY_NOT_CURRENT");
        }
        const submission = prepareInterventionSubmission(
          scope,
          state.context,
          previous,
          command,
          now,
        );
        const ref = businessObjectRef(submission.version);
        const versions = new Map(staged.versions.get(objectKey(ref)) ?? []);
        versions.set(ref.revision, structuredClone(submission.version));
        staged.versions.set(objectKey(ref), versions);
        staged.latest.set(objectKey(ref), ref.revision);
        staged.context = submission.context;
        events = submission.events.map((draft, index) =>
          memoryTaskBusinessEvent(scope, draft, this.#businessEvents.length + index + 1),
        );
      }
      staged.commands.set(command.commandId, structuredClone(command));
      // No asynchronous boundary separates command, Context, object and source events.
      this.#scopes.set(scope.key(), staged);
      if (events) this.#businessEvents.push(...events);
      return {
        claimed: true,
        record: structuredClone(command),
        ...(events ? { events: structuredClone(events) } : {}),
      };
    });
  }

  commitChangeSet(changeSet: BusinessChangeSet): Promise<TaskBusinessContext> {
    return this.#commitChangeSet(changeSet, []);
  }

  #commitChangeSet(
    changeSet: BusinessChangeSet,
    events: readonly TaskBusinessEventDraft[],
  ): Promise<TaskBusinessContext> {
    return Promise.resolve().then(() => {
      const { scope } = changeSet;
      assertBoundExecutionScope(scope);
      const context = parseBusinessContext(scope, changeSet.context);
      const contents = validateBusinessContentWrites(changeSet);
      const previous = this.#scopes.get(scope.key()) ?? emptyState();
      const current = previous.context;
      if (
        (current === undefined && changeSet.expectedContextRevision !== null) ||
        (current !== undefined && changeSet.expectedContextRevision !== current.contextRevision)
      ) {
        throw new Error("BUSINESS_CONTEXT_REVISION_CONFLICT");
      }
      if (
        (current === undefined && ![0, 1].includes(context.contextRevision)) ||
        (current !== undefined && context.contextRevision !== current.contextRevision + 1)
      ) {
        throw new Error("BUSINESS_CONTEXT_REVISION_INVALID");
      }
      if (current && context.effectivePlanRevision < current.effectivePlanRevision) {
        throw new Error("BUSINESS_PLAN_REVISION_REGRESSION");
      }
      assertBusinessContextTimeProgression(current, context);
      if (current?.summary.status === "finalized") throw new Error("BUSINESS_CONTEXT_FINALIZED");

      const staged: ScopeState = {
        context,
        versions: new Map(previous.versions),
        latest: new Map(previous.latest),
        commands: new Map(previous.commands),
        contents: new Map(previous.contents),
      };
      const changedKeys = new Set<string>();
      const published: BusinessObjectVersion[] = [];
      for (const candidate of changeSet.objects) {
        const version = parseBusinessObjectVersion(scope, candidate);
        published.push(version);
        const ref = businessObjectRef(version);
        const key = objectKey(ref);
        if (changedKeys.has(key)) throw new Error("BUSINESS_OBJECT_DUPLICATE_IN_CHANGESET");
        changedKeys.add(key);
        const latestRevision = staged.latest.get(key);
        if (ref.revision !== (latestRevision ?? 0) + 1) {
          throw new Error("BUSINESS_OBJECT_REVISION_CONFLICT");
        }
        const prior =
          latestRevision === undefined ? undefined : staged.versions.get(key)?.get(latestRevision);
        if (prior?.kind === version.kind) {
          if (prior.kind === "artifact" && version.kind === "artifact") {
            if (prior.value.artifactType !== version.value.artifactType) {
              throw new Error("BUSINESS_ARTIFACT_TYPE_CHANGED");
            }
          } else if (prior.kind === "action" && version.kind === "action") {
            assertActionTransition(prior.value, version.value);
          } else if (prior.kind === "input_request" && version.kind === "input_request") {
            assertRequiredInputTransition(prior.value, version.value);
          } else if (prior.kind === "intervention" && version.kind === "intervention") {
            assertInterventionTransition(prior.value, version.value);
          }
        }
        const versions = new Map(staged.versions.get(key) ?? []);
        versions.set(ref.revision, structuredClone(version));
        staged.versions.set(key, versions);
        staged.latest.set(key, ref.revision);
      }

      const contextRefs = [
        ...Object.values(context.activeRefs),
        ...context.artifactRefs,
        ...context.actionRefs,
        ...context.requiredInputRefs,
        ...context.interventionRefs,
      ];
      const listedRefs = new Set(
        [
          ...context.artifactRefs,
          ...context.actionRefs,
          ...context.requiredInputRefs,
          ...context.interventionRefs,
        ].map((ref) => JSON.stringify([ref.kind, ref.id, ref.revision])),
      );
      for (const ref of Object.values(context.activeRefs)) {
        if (!listedRefs.has(JSON.stringify([ref.kind, ref.id, ref.revision]))) {
          throw new Error("BUSINESS_ACTIVE_REF_NOT_LISTED");
        }
      }
      for (const ref of contextRefs) {
        if (!staged.versions.get(objectKey(ref))?.has(ref.revision)) {
          throw new Error("BUSINESS_CONTEXT_REF_NOT_FOUND");
        }
      }
      const terminalCommand = changeSet.command
        ? parseBusinessCommandRecord(scope, changeSet.command)
        : undefined;
      for (const version of published) {
        if (
          version.kind !== "input_request" ||
          (version.value.state !== "answered" &&
            version.value.state !== "declined" &&
            !(version.value.state === "cancelled" && version.value.response?.action === "cancel"))
        )
          continue;
        const claimed = version.value.responseCommandId
          ? staged.commands.get(version.value.responseCommandId)
          : undefined;
        assertRequiredInputReplyClaim(current, context, version.value, claimed);
      }
      assertInterventionAppliedFacts(current, context, published, terminalCommand);
      assertInterventionRejectedFacts(current, context, published, terminalCommand);
      assertInterventionTerminalPublicEvents(context, published, terminalCommand, events);
      const priorAreaRef = current?.activeRefs.reconEffectiveArea ?? {
        kind: "artifact" as const,
        id: "recon-requested-area",
        revision: 1,
      };
      const priorArea = staged.versions.get(objectKey(priorAreaRef))?.get(priorAreaRef.revision);
      assertReconAreaAdoptionFacts(current, context, published, events, priorArea);
      if (terminalCommand) {
        const command = terminalCommand;
        const claimed = staged.commands.get(command.commandId);
        if (!claimed) throw new Error("BUSINESS_COMMAND_CLAIM_REQUIRED");
        if (
          claimed.commandType !== command.commandType ||
          claimed.requestHash !== command.requestHash ||
          claimed.responseHash !== command.responseHash ||
          claimed.createdAt !== command.createdAt ||
          claimed.entryKey !== command.entryKey ||
          claimed.runtimeCommandSequence !== command.runtimeCommandSequence
        ) {
          throw new Error("COMMAND_ID_CONFLICT");
        }
        if (Date.parse(command.updatedAt) < Date.parse(claimed.updatedAt)) {
          throw new Error("BUSINESS_COMMAND_TIME_REGRESSION");
        }
        if (claimed.state !== "accepted" || command.state === "accepted") {
          throw new Error("BUSINESS_COMMAND_TRANSITION_INVALID");
        }
        for (const ref of command.resultRefs ?? []) {
          if (!staged.versions.get(objectKey(ref))?.has(ref.revision)) {
            throw new Error("BUSINESS_COMMAND_RESULT_REF_NOT_FOUND");
          }
        }
        staged.commands.set(command.commandId, structuredClone(command));
      }
      for (const content of contents) {
        if (staged.contents.has(content.handle))
          throw new Error("ARTIFACT_CONTENT_HANDLE_CONFLICT");
        staged.contents.set(content.handle, { ...content, bytes: Uint8Array.from(content.bytes) });
      }
      // One synchronous map replacement is the in-memory transaction boundary.
      this.#scopes.set(scope.key(), staged);
      return structuredClone(context);
    });
  }

  async commitBusinessChangeSet(
    changeSet: BusinessChangeSet,
    events: readonly TaskBusinessEventDraft[],
  ): Promise<CommittedBusinessChangeSet> {
    const context = parseBusinessContext(changeSet.scope, changeSet.context);
    const prepared = events.map((candidate) => {
      const draft = parseTaskBusinessEventDraft(context, candidate);
      return { draft, rawPayload: jsonToProtoStruct(draft.body) };
    });
    const committedContext = await this.#commitChangeSet(
      changeSet,
      prepared.map(({ draft }) => draft),
    );
    const firstSequence = this.#businessEvents.length + 1;
    const committedEvents = prepared.map(({ draft }, index) => {
      const event = memoryTaskBusinessEvent(changeSet.scope, draft, firstSequence + index);
      this.#businessEvents.push(event);
      return structuredClone(event);
    });
    return { context: committedContext, events: committedEvents };
  }
}
import { createHash, randomUUID } from "node:crypto";
import { jsonToProtoStruct, type AdapterBusinessEvent } from "../../adapter-protocol/src/index.js";

function memoryTaskBusinessEvent(
  scope: BoundExecutionScope,
  draft: TaskBusinessEventDraft,
  sequenceNumber: number,
): AdapterBusinessEvent {
  const sequence = String(sequenceNumber);
  return {
    sourceEventId: createHash("sha256")
      .update(`vehicle.business\0${sequence}\0${randomUUID()}`)
      .digest("base64url"),
    sourceSequence: sequence,
    sourceStreamId: taskBusinessSourceCapability().sourceStreamId,
    scope: "task",
    occurredAt: {
      seconds: String(Math.floor(Date.parse(draft.body.providerRecordedAt) / 1000)),
      nanos: (Date.parse(draft.body.providerRecordedAt) % 1000) * 1_000_000,
    },
    eventType: "vehicle.business.changed",
    description: draft.description,
    externalExecutionId: scope.executionId,
    resourceRef: scope.resourceId,
    severityHint: draft.severityHint,
    reasonCode: draft.reasonCode,
    rawPayload: jsonToProtoStruct(draft.body),
  };
}
