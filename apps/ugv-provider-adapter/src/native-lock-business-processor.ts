import { createHash } from "node:crypto";
import { z } from "zod";
import type { AdapterBusinessEvent } from "../../../packages/adapter-protocol/src/index.js";
import {
  BoundExecutionScope,
  scopeBusinessIdentity,
  type ProviderExecution,
  type TaskBusinessStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
  type BusinessObjectRef,
} from "../../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  BusinessActionSchema,
  RequiredInputSchema,
  type BusinessAction,
  type RequiredInput,
} from "../../../packages/vehicle-provider-core/src/task-business-interaction.js";
import { compareIsoTimestamps } from "../../../packages/vehicle-provider-core/src/time.js";
import type { ProviderLockDispatch } from "./provider-auto-lock-coordinator.js";

const id = z.string().min(1).max(256);
const lockFactSchema = z
  .object({
    schemaVersion: z.literal("ugv.recon-native-lock-fact/1"),
    missionId: id,
    sourceCursor: z.string().min(1).max(4096),
    observedAt: z.iso.datetime({ offset: true }),
    stage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    targetId: id.optional(),
    motionStatus: z.number().int(),
  })
  .strict();

const terminal = new Set(["SUCCEEDED", "BUSINESS_FAILED", "CANCELLED", "TECHNICAL_FAILED"]);
const lockKey = (missionId: string) => `visualLock:${missionId}`;
const inputKey = "input:visualLock";
const sourceTarget = (action: BusinessAction): string | undefined =>
  typeof action.properties?.sourceTargetId === "string"
    ? action.properties.sourceTargetId
    : undefined;
const sourceHash = (value: string) => createHash("sha256").update(value).digest("hex");

function terminalOutcome(motionStatus: number): {
  state: "completed" | "failed" | "cancelled";
  endReason: string;
} {
  if (motionStatus === 11) return { state: "completed", endReason: "OBSERVATION_ENDED" };
  if (motionStatus === 10) return { state: "failed", endReason: "RECON_FAILED" };
  if (motionStatus === 9) return { state: "cancelled", endReason: "RECON_INTERRUPTED" };
  return { state: "completed", endReason: "VISUAL_LOCK_END_CAUSE_UNKNOWN" };
}

/** Projects only exact, mission-bound device observations. It never dispatches control. */
export class NativeLockBusinessProcessor {
  constructor(
    readonly business: Pick<
      TaskBusinessStore,
      "getContext" | "getContextSnapshot" | "getObjectVersion" | "commitBusinessChangeSet"
    >,
    readonly notifyCommitted: (event: AdapterBusinessEvent) => void,
    readonly manualDecision?: {
      maxWaitMs: number;
      onExpire: RequiredInput["onExpire"];
      onDismiss: RequiredInput["onDismiss"];
      now?: () => Date;
      requireProviderPolicy?: boolean;
    },
  ) {}

  /** A qualified target-list loss retires only the matching input, without inventing release. */
  async invalidateForTargetLoss(
    execution: ProviderExecution,
    targetId: string,
  ): Promise<"committed" | "none"> {
    const missionId = execution.downstreamMissionIds.at(-1);
    if (
      execution.operationName !== "vehicle_area_recon" ||
      execution.taskBusinessContextExpected !== true ||
      missionId === undefined ||
      terminal.has(execution.state) ||
      !id.safeParse(targetId).success
    )
      throw new Error("NATIVE_LOCK_TARGET_LOSS_BINDING_INVALID");
    const scope = BoundExecutionScope.fromExecution(execution);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.business.getContext(scope);
      if (!current || current.summary.status === "finalized") return "none";
      const pendingRef = current.activeRefs[inputKey];
      if (pendingRef?.kind !== "input_request") return "none";
      const pendingVersion = await this.business.getObjectVersion(scope, pendingRef);
      if (pendingVersion?.kind !== "input_request" || pendingVersion.value.state !== "pending")
        return "none";
      const pending = pendingVersion.value;
      if (
        pending.subjectBinding.kind !== "visual_lock" ||
        pending.subjectBinding.targetId !== targetId
      )
        return "none";
      const snapshot = await this.business.getContextSnapshot(scope);
      const latest = new Map<
        string,
        { revision: number; visibility: unknown; observedAt: string }
      >();
      for (const item of snapshot?.objects ?? []) {
        if (
          item.kind !== "artifact" ||
          item.value.artifactType !== "target.object" ||
          item.value.source.method !== "mqtt_area_recon_targets" ||
          item.value.source.sourceRecordRef !== targetId ||
          item.value.properties === undefined ||
          !("observationSessionId" in item.value.properties) ||
          item.value.properties.observationSessionId !== missionId ||
          !("visibility" in item.value.properties)
        )
          continue;
        const prior = latest.get(item.value.artifactId);
        if (prior && prior.revision >= item.value.revision) continue;
        latest.set(item.value.artifactId, {
          revision: item.value.revision,
          visibility: item.value.properties.visibility,
          observedAt: item.value.updatedAt,
        });
      }
      const [target] = latest.values();
      if (latest.size !== 1 || target?.visibility !== "lost") return "none";
      const resolvedAt = [target.observedAt, pending.requestedAt, current.updatedAt].reduce(
        (latestAt, candidate) =>
          compareIsoTimestamps(candidate, latestAt) > 0 ? candidate : latestAt,
      );
      const cancelled = RequiredInputSchema.parse({
        ...pending,
        revision: pending.revision + 1,
        state: "cancelled",
        reasonCode: "TARGET_LOST_DURING_OBSERVATION",
        resolvedAt,
      });
      const ref = {
        kind: "input_request" as const,
        id: cancelled.requestId,
        revision: cancelled.revision,
      };
      const context = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        activeRefs: Object.fromEntries(
          Object.entries(current.activeRefs).filter(([key]) => key !== inputKey),
        ),
        requiredInputRefs: [...current.requiredInputRefs, ref],
        updatedAt: resolvedAt,
      });
      const reasonCode = "TARGET_LOST_DURING_OBSERVATION";
      try {
        const committed = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: current.contextRevision,
            context,
            objects: [{ kind: "input_request", value: cancelled }],
          },
          [
            {
              body: TaskBusinessFeedbackBodySchema.parse({
                schemaVersion: "sdar.task-business-feedback/1.0-rc2",
                kind: "REQUIRED_INPUT_CHANGED",
                contextRevision: context.contextRevision,
                providerRecordedAt: resolvedAt,
                payload: {
                  change: "update",
                  requestRef: ref,
                  previousRevision: pending.revision,
                  reasonCode,
                },
              }),
              description: reasonCode,
              reasonCode,
              severityHint: "info",
            },
          ],
        );
        for (const event of committed.events) this.notifyCommitted(event);
        return "committed";
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "BUSINESS_CONTEXT_REVISION_CONFLICT" ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new Error("NATIVE_LOCK_TARGET_LOSS_RETRY_EXHAUSTED");
  }

  async apply(
    execution: ProviderExecution,
    input: unknown,
    policyDispatch?: ProviderLockDispatch,
  ): Promise<"committed" | "duplicate"> {
    const fact = lockFactSchema.parse(input);
    if (
      execution.operationName !== "vehicle_area_recon" ||
      execution.taskBusinessContextExpected !== true ||
      execution.downstreamMissionIds.at(-1) !== fact.missionId ||
      compareIsoTimestamps(fact.observedAt, execution.createdAt) < 0 ||
      terminal.has(execution.state)
    )
      throw new Error("NATIVE_LOCK_EXECUTION_BINDING_INVALID");
    const scope = BoundExecutionScope.fromExecution(execution);
    const key = lockKey(fact.missionId);
    const cursorHash = sourceHash(fact.sourceCursor);
    const signature = sourceHash(
      JSON.stringify([
        fact.missionId,
        fact.observedAt,
        fact.stage,
        fact.targetId ?? null,
        fact.motionStatus,
      ]),
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.business.getContext(scope);
      if (!current || current.summary.status === "finalized")
        throw new Error("NATIVE_LOCK_CONTEXT_UNAVAILABLE");
      const sameMission = current.summary.properties?.nativeLockMissionId === fact.missionId;
      if (sameMission && current.summary.properties?.nativeLockCursorHash === cursorHash) {
        const previousSignature = current.summary.properties.nativeLockSignature;
        if (previousSignature !== undefined && previousSignature !== signature)
          throw new Error("NATIVE_LOCK_SOURCE_CURSOR_CONFLICT");
        return "duplicate";
      }
      const lastObservedAt = sameMission
        ? current.summary.properties?.nativeLockObservedAt
        : undefined;
      if (
        typeof lastObservedAt === "string" &&
        compareIsoTimestamps(fact.observedAt, lastObservedAt) <= 0
      )
        return "duplicate";
      const properties = {
        ...current.summary.properties,
        nativeLockMissionId: fact.missionId,
        nativeLockCursorHash: cursorHash,
        nativeLockSignature: signature,
        nativeLockObservedAt: fact.observedAt,
      };
      const activeRef = current.activeRefs[key];
      const activeVersion = activeRef && (await this.business.getObjectVersion(scope, activeRef));
      if (activeRef && activeVersion?.kind !== "action")
        throw new Error("NATIVE_LOCK_ACTIVE_REF_INVALID");
      const active = activeVersion?.kind === "action" ? activeVersion.value : undefined;
      if (
        active &&
        (active.actionType !== "sensor.visual_lock" ||
          (active.state !== "active" &&
            !(active.state === "requested" && active.triggerOrigin === "provider_policy")))
      )
        throw new Error("NATIVE_LOCK_ACTIVE_ACTION_INVALID");
      if (active?.requestedAt && compareIsoTimestamps(fact.observedAt, active.requestedAt) < 0)
        return "duplicate";
      if (active?.startedAt && compareIsoTimestamps(fact.observedAt, active.startedAt) < 0)
        return "duplicate";
      const objects: BusinessAction[] = [];
      let sourceOnly = false;
      let targetLost = false;
      const activeRefs = Object.fromEntries(
        Object.entries(current.activeRefs).filter(([candidate]) => candidate !== key),
      );
      if (fact.stage === 1) {
        if (!active || (active.state === "requested" && fact.motionStatus === 5)) {
          sourceOnly = true;
        } else {
          const outcome = terminalOutcome(fact.motionStatus);
          objects.push(
            BusinessActionSchema.parse({
              ...active,
              revision: active.revision + 1,
              state:
                active.state === "requested" && outcome.state === "completed"
                  ? "cancelled"
                  : outcome.state,
              reasonCode: outcome.endReason,
              endReason: outcome.endReason,
              endedAt: fact.observedAt,
              properties: { ...active.properties, phase: "resuming", nativeLockStage: 1 },
            }),
          );
        }
      } else if (fact.stage === 4 || fact.targetId === undefined || fact.targetId === "0") {
        // These facts cannot qualify an Action or a release, but still order the source stream.
        sourceOnly = true;
      } else if (
        active?.triggerOrigin === "provider_policy" &&
        sourceTarget(active) === fact.targetId &&
        (fact.stage === 2 ||
          (active.state === "requested" &&
            (policyDispatch?.actionId !== active.actionId ||
              compareIsoTimestamps(fact.observedAt, policyDispatch.dispatchedAt) <= 0)))
      ) {
        // A requested policy Action needs a durable dispatch fence AND a later
        // observing fact. Stage 2 and command ACK never activate it.
        sourceOnly = true;
      } else {
        const snapshot = await this.business.getContextSnapshot(scope);
        const latestTargets = new Map<
          string,
          { ref: BusinessObjectRef; visibility: unknown; observedAt: string }
        >();
        for (const item of snapshot?.objects ?? []) {
          const properties = item.kind === "artifact" ? item.value.properties : undefined;
          if (
            item.kind !== "artifact" ||
            item.value.artifactType !== "target.object" ||
            item.value.source.sourceRecordRef !== fact.targetId ||
            properties === undefined ||
            !("observationSessionId" in properties) ||
            properties.observationSessionId !== fact.missionId ||
            !("visibility" in properties)
          )
            continue;
          const previous = latestTargets.get(item.value.artifactId);
          if (previous && previous.ref.revision >= item.value.revision) continue;
          latestTargets.set(item.value.artifactId, {
            ref: { kind: "artifact", id: item.value.artifactId, revision: item.value.revision },
            visibility: properties.visibility,
            observedAt: item.value.updatedAt,
          });
        }
        const [target] = latestTargets.values();
        // A delayed lock fact must not resurrect a prompt after a newer target
        // observation has already declared the same target lost.
        targetLost = latestTargets.size === 1 && target?.visibility === "lost";
        const targetRef =
          latestTargets.size === 1 &&
          target?.visibility === "visible" &&
          compareIsoTimestamps(target.observedAt, fact.observedAt) <= 0
            ? target.ref
            : undefined;
        if (active && sourceTarget(active) !== fact.targetId) {
          objects.push(
            BusinessActionSchema.parse({
              ...active,
              revision: active.revision + 1,
              state: active.state === "requested" ? "cancelled" : "completed",
              reasonCode: "VISUAL_LOCK_REPLACED",
              endReason: "VISUAL_LOCK_REPLACED",
              endedAt: fact.observedAt,
              properties: { ...active.properties, phase: "resuming" },
            }),
          );
        }
        const sameTarget = active && sourceTarget(active) === fact.targetId ? active : undefined;
        const phase = fact.stage === 2 ? "locking" : "observing";
        sourceOnly = Boolean(
          (sameTarget?.triggerOrigin === "provider_policy" && (!targetRef || targetLost)) ||
          (sameTarget &&
            sameTarget.properties?.phase === phase &&
            ((sameTarget.subjectRefs?.length ?? 0) > 0 || targetRef === undefined)),
        );
        if (!sourceOnly) {
          const action = BusinessActionSchema.parse({
            ...(sameTarget ?? {}),
            schemaVersion: "sdar.business-action/1.0-rc2",
            actionId:
              sameTarget?.actionId ??
              `lock-${sourceHash(
                JSON.stringify([
                  execution.externalExecutionId,
                  fact.missionId,
                  fact.targetId,
                  fact.sourceCursor,
                ]),
              ).slice(0, 32)}`,
            actionType: "sensor.visual_lock",
            identity: scopeBusinessIdentity(scope),
            revision: (sameTarget?.revision ?? 0) + 1,
            state: "active",
            actor: sameTarget?.actor ?? { type: "device" },
            // The source reports a device state, but not who triggered it.
            triggerOrigin: sameTarget?.triggerOrigin ?? "unknown",
            ...(sameTarget?.subjectRefs !== undefined
              ? { subjectRefs: sameTarget.subjectRefs }
              : targetRef === undefined
                ? {}
                : { subjectRefs: [targetRef] }),
            cause: { ...sameTarget?.cause, eventType: "mqtt_area_recon_status" },
            reasonCode:
              fact.stage === 2 ? "VISUAL_LOCK_LOCKING_OBSERVED" : "VISUAL_LOCK_ACTIVE_OBSERVED",
            startedAt: sameTarget?.startedAt ?? fact.observedAt,
            properties: {
              ...sameTarget?.properties,
              observationSessionId: fact.missionId,
              sourceTargetId: fact.targetId,
              phase,
              nativeLockStage: fact.stage,
              triggerQualification:
                sameTarget?.triggerOrigin === "provider_policy"
                  ? "journal_and_observation"
                  : "unverified",
            },
          });
          objects.push(action);
          activeRefs[key] = { kind: "action", id: action.actionId, revision: action.revision };
        }
      }
      const refs = objects.map((action) => ({
        kind: "action" as const,
        id: action.actionId,
        revision: action.revision,
      }));
      let nextActiveRefs = { ...(sourceOnly ? current.activeRefs : activeRefs) };
      const inputObjects: RequiredInput[] = [];
      const inputChanges: { value: RequiredInput; change: "create" | "update" }[] = [];
      const pendingRef = current.activeRefs[inputKey];
      const pendingVersion =
        pendingRef && (await this.business.getObjectVersion(scope, pendingRef));
      if (pendingRef && pendingVersion?.kind !== "input_request")
        throw new Error("NATIVE_LOCK_INPUT_REF_INVALID");
      const pending = pendingVersion?.kind === "input_request" ? pendingVersion.value : undefined;
      if (pending && pending.state !== "pending")
        throw new Error("NATIVE_LOCK_INPUT_STATE_INVALID");
      const nextLock = nextActiveRefs[key];
      if (
        pending &&
        (nextLock?.kind !== "action" ||
          pending.subjectBinding.kind !== "visual_lock" ||
          nextLock.id !== pending.subjectBinding.lockSessionId ||
          targetLost)
      ) {
        const cancelled = RequiredInputSchema.parse({
          ...pending,
          revision: pending.revision + 1,
          state: "cancelled",
          reasonCode: targetLost ? "TARGET_LOST_DURING_OBSERVATION" : "VISUAL_LOCK_SESSION_ENDED",
          resolvedAt: fact.observedAt,
        });
        inputObjects.push(cancelled);
        inputChanges.push({ value: cancelled, change: "update" });
        nextActiveRefs = Object.fromEntries(
          Object.entries(nextActiveRefs).filter(([candidate]) => candidate !== inputKey),
        );
      }
      const observing = [...objects]
        .reverse()
        .find((action) => action.state === "active" && action.properties?.phase === "observing");
      if (
        this.manualDecision &&
        observing &&
        (!this.manualDecision.requireProviderPolicy ||
          observing.triggerOrigin === "provider_policy") &&
        !targetLost &&
        nextActiveRefs[inputKey] === undefined
      ) {
        if (
          !Number.isInteger(this.manualDecision.maxWaitMs) ||
          this.manualDecision.maxWaitMs < 1_000
        )
          throw new Error("NATIVE_LOCK_INPUT_POLICY_INVALID");
        const deadlineMs = Date.parse(fact.observedAt) + this.manualDecision.maxWaitMs;
        // A delayed observation still projects the lock but cannot create an expired prompt.
        if (deadlineMs > (this.manualDecision.now?.() ?? new Date()).getTime()) {
          const requestId = `decision-${sourceHash(observing.actionId).slice(0, 32)}`;
          const prior = await this.business.getObjectVersion(scope, {
            kind: "input_request",
            id: requestId,
            revision: 1,
          });
          if (prior === undefined) {
            const request = RequiredInputSchema.parse({
              schemaVersion: "sdar.required-input/1.0-rc2",
              requestId,
              requestKey: `target-decision:${observing.actionId}`,
              inputType: "target.disposition_decision",
              identity: scopeBusinessIdentity(scope),
              revision: 1,
              blocking: true,
              state: "pending",
              requiredResponder: "user",
              subjectBinding: {
                kind: "visual_lock",
                targetId: fact.targetId,
                lockSessionId: observing.actionId,
                actionRef: { kind: "action", id: observing.actionId, revision: observing.revision },
              },
              waitingPolicy: "pause_execution",
              onExpire: this.manualDecision.onExpire,
              onDismiss: this.manualDecision.onDismiss,
              onDecline: "release_and_resume_scan",
              title: "Choose target observation",
              inputSchema: {
                type: "object",
                properties: { decision: { const: "continue_observation" } },
                required: ["decision"],
                additionalProperties: false,
              },
              reasonCode: "TARGET_OBSERVATION_DECISION_REQUIRED",
              requestedAt: fact.observedAt,
              deadlineAt: new Date(deadlineMs).toISOString(),
            });
            inputObjects.push(request);
            inputChanges.push({ value: request, change: "create" });
            nextActiveRefs[inputKey] = { kind: "input_request", id: requestId, revision: 1 };
          }
        }
      }
      const inputRefs = inputObjects.map((request) => ({
        kind: "input_request" as const,
        id: request.requestId,
        revision: request.revision,
      }));
      const context = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        summary: { ...current.summary, properties },
        activeRefs: nextActiveRefs,
        actionRefs: [...current.actionRefs, ...refs],
        requiredInputRefs: [...current.requiredInputRefs, ...inputRefs],
        updatedAt:
          compareIsoTimestamps(current.updatedAt, fact.observedAt) > 0
            ? current.updatedAt
            : fact.observedAt,
      });
      const events = objects.map((action, index) => {
        const reasonCode = action.reasonCode;
        return {
          body: TaskBusinessFeedbackBodySchema.parse({
            schemaVersion: "sdar.task-business-feedback/1.0-rc2",
            kind: "ACTION_CHANGED",
            contextRevision: context.contextRevision,
            providerRecordedAt: fact.observedAt,
            payload: {
              change: action.revision === 1 ? "create" : "update",
              actionRef: refs[index],
              ...(action.revision === 1 ? {} : { previousRevision: action.revision - 1 }),
              reasonCode,
            },
          }),
          description: reasonCode,
          reasonCode,
          severityHint: "info" as const,
        };
      });
      for (const { value, change } of inputChanges) {
        const reasonCode = value.reasonCode;
        events.push({
          body: TaskBusinessFeedbackBodySchema.parse({
            schemaVersion: "sdar.task-business-feedback/1.0-rc2",
            kind: "REQUIRED_INPUT_CHANGED",
            contextRevision: context.contextRevision,
            providerRecordedAt: fact.observedAt,
            payload: {
              change,
              requestRef: {
                kind: "input_request",
                id: value.requestId,
                revision: value.revision,
              },
              ...(change === "update" ? { previousRevision: value.revision - 1 } : {}),
              reasonCode,
            },
          }),
          description: reasonCode,
          reasonCode,
          severityHint: "info",
        });
      }
      try {
        const committed = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: current.contextRevision,
            context,
            objects: [
              ...objects.map((value) => ({ kind: "action" as const, value })),
              ...inputObjects.map((value) => ({ kind: "input_request" as const, value })),
            ],
          },
          events,
        );
        for (const event of committed.events) this.notifyCommitted(event);
        return "committed";
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "BUSINESS_CONTEXT_REVISION_CONFLICT" ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new Error("NATIVE_LOCK_RETRY_EXHAUSTED");
  }
}
