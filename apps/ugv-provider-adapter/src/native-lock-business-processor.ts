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
  type BusinessAction,
} from "../../../packages/vehicle-provider-core/src/task-business-interaction.js";
import { compareIsoTimestamps } from "../../../packages/vehicle-provider-core/src/time.js";

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
  ) {}

  async apply(execution: ProviderExecution, input: unknown): Promise<"committed" | "duplicate"> {
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
      if (active && (active.actionType !== "sensor.visual_lock" || active.state !== "active"))
        throw new Error("NATIVE_LOCK_ACTIVE_ACTION_INVALID");
      if (active?.startedAt && compareIsoTimestamps(fact.observedAt, active.startedAt) < 0)
        return "duplicate";
      const objects: BusinessAction[] = [];
      let sourceOnly = false;
      const activeRefs = Object.fromEntries(
        Object.entries(current.activeRefs).filter(([candidate]) => candidate !== key),
      );
      if (fact.stage === 1) {
        if (!active) {
          sourceOnly = true;
        } else {
          const outcome = terminalOutcome(fact.motionStatus);
          objects.push(
            BusinessActionSchema.parse({
              ...active,
              revision: active.revision + 1,
              state: outcome.state,
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
              state: "completed",
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
          sameTarget &&
          sameTarget.properties?.phase === phase &&
          ((sameTarget.subjectRefs?.length ?? 0) > 0 || targetRef === undefined),
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
            actor: { type: "device" },
            // The source reports a device state, but not who triggered it.
            triggerOrigin: "unknown",
            ...(sameTarget?.subjectRefs !== undefined
              ? { subjectRefs: sameTarget.subjectRefs }
              : targetRef === undefined
                ? {}
                : { subjectRefs: [targetRef] }),
            cause: { eventType: "mqtt_area_recon_status" },
            reasonCode:
              fact.stage === 2 ? "VISUAL_LOCK_LOCKING_OBSERVED" : "VISUAL_LOCK_ACTIVE_OBSERVED",
            startedAt: sameTarget?.startedAt ?? fact.observedAt,
            properties: {
              observationSessionId: fact.missionId,
              sourceTargetId: fact.targetId,
              phase,
              nativeLockStage: fact.stage,
              triggerQualification: "unverified",
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
      const context = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        summary: { ...current.summary, properties },
        activeRefs: sourceOnly ? current.activeRefs : activeRefs,
        actionRefs: [...current.actionRefs, ...refs],
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
      try {
        const committed = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: current.contextRevision,
            context,
            objects: objects.map((value) => ({ kind: "action" as const, value })),
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
