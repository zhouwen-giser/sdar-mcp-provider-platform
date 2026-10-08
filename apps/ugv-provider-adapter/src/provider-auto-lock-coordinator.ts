import { createHash } from "node:crypto";
import { compareIsoTimestamps } from "../../../packages/vehicle-provider-core/src/time.js";
import type { AdapterBusinessEvent } from "../../../packages/adapter-protocol/src/index.js";
import {
  BoundExecutionScope,
  scopeBusinessIdentity,
  type ProviderExecution,
  type ProviderStore,
  type TaskBusinessStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
} from "../../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  BusinessActionSchema,
  type BusinessAction,
} from "../../../packages/vehicle-provider-core/src/task-business-interaction.js";

export interface ProviderLockDispatch {
  actionId: string;
  dispatchedAt: string;
}

export const AUTO_LOCK_POLICY = "ugv.sequential-visible-target/1";
export const providerAutoLockStepId = (actionId: string): string => `auto-lock:${actionId}`;

/** One attempt per target per recon mission. Dispatch uses the existing journal. */
export class ProviderAutoLockCoordinator {
  constructor(
    readonly business: Pick<
      TaskBusinessStore,
      "getContext" | "getContextSnapshot" | "getObjectVersion" | "commitBusinessChangeSet"
    >,
    readonly executions: Pick<ProviderStore, "getExecution" | "getMutationJournalEntry">,
    readonly notifyCommitted: (event: AdapterBusinessEvent) => void,
    readonly now: () => Date,
    readonly confirmationTimeoutMs: number,
    readonly maximumFutureSkewMs = 0,
  ) {}

  async run(input: {
    execution: ProviderExecution;
    /** Only IDs from the just-qualified complete, non-retained mission target list. */
    candidateIds: readonly string[];
    canDispatch: (targetId: string) => boolean;
    controlPending: () => boolean;
    dispatch: (stepId: string, targetId: string) => Promise<void>;
  }): Promise<void> {
    const { execution } = input;
    const missionId = execution.downstreamMissionIds.at(-1);
    if (
      execution.operationName !== "vehicle_area_recon" ||
      !execution.taskBusinessContextExpected ||
      !missionId
    )
      return;
    if (!Number.isSafeInteger(this.confirmationTimeoutMs) || this.confirmationTimeoutMs < 1_000)
      throw new Error("UGV_AUTO_LOCK_TIMEOUT_INVALID");
    const scope = BoundExecutionScope.fromExecution(execution);
    const key = `visualLock:${missionId}`;
    let context = await this.business.getContext(scope);
    if (context?.summary.status !== "in_progress") return;
    const boundExecution = await this.executions.getExecution(execution.taskId);
    if (
      boundExecution?.externalExecutionId !== execution.externalExecutionId ||
      boundExecution.downstreamMissionIds.at(-1) !== missionId
    )
      return;
    // A requested Action from a superseded mission can never be confirmed by
    // the current mission. Retire the request; this does not assert physical
    // release of any possibly dispatched or already observed lock.
    for (const [name, ref] of Object.entries(context.activeRefs)) {
      if (!name.startsWith("visualLock:") || name === key || ref.kind !== "action") continue;
      const version = await this.business.getObjectVersion(scope, ref);
      if (
        version?.kind !== "action" ||
        version.value.triggerOrigin !== "provider_policy" ||
        version.value.state !== "requested" ||
        name !== `visualLock:${String(version.value.properties?.observationSessionId)}`
      )
        continue;
      await this.finish(execution, version.value, "cancelled", "UGV_AUTO_LOCK_MISSION_REPLACED");
      context = await this.business.getContext(scope);
      if (context?.summary.status !== "in_progress") return;
    }
    let action: BusinessAction | undefined;
    const selected = context.summary.properties?.providerAutoLockMissionId === missionId;
    const currentRef = context.activeRefs[key];
    if (currentRef) {
      const version = await this.business.getObjectVersion(scope, currentRef);
      if (
        !selected ||
        version?.kind !== "action" ||
        version.value.triggerOrigin !== "provider_policy" ||
        version.value.actionId !== context.summary.properties?.providerAutoLockActionId ||
        version.value.state !== "requested"
      )
        return;
      action = version.value;
    } else {
      if (
        execution.state !== "RUNNING" ||
        input.controlPending() ||
        Object.keys(context.activeRefs).some((name) => name.startsWith("visualLock:")) ||
        context.activeRefs["input:visualLock"]
      )
        return;
      const snapshot = await this.business.getContextSnapshot(scope);
      const latest = new Map<
        string,
        Extract<NonNullable<typeof snapshot>["objects"][number], { kind: "artifact" }>
      >();
      // Action versions already persist every attempted target in this mission.
      // Reuse that history rather than adding a session store or a target ledger.
      const attemptedIds = new Set<string>();
      let previousSelection: BusinessAction | undefined;
      for (const object of snapshot?.objects ?? []) {
        if (object.kind === "artifact") {
          const previous = latest.get(object.value.artifactId);
          if (!previous || object.value.revision > previous.value.revision)
            latest.set(object.value.artifactId, object);
        } else if (
          object.kind === "action" &&
          object.value.actionType === "sensor.visual_lock" &&
          object.value.triggerOrigin === "provider_policy" &&
          object.value.properties?.observationSessionId === missionId
        ) {
          const id = object.value.properties?.sourceTargetId;
          if (typeof id === "string") attemptedIds.add(id);
          if (
            selected &&
            object.value.actionId === context.summary.properties?.providerAutoLockActionId &&
            (!previousSelection || object.value.revision > previousSelection.revision)
          )
            previousSelection = object.value;
        }
      }
      // Continue only after the previous Action has ended AND a new scanning
      // status has established that there is no active visual lock. Never use
      // an old target list as justification for a second device command.
      const previousEnd = previousSelection?.endedAt;
      if (selected) {
        const lockStatusAt = context.summary.properties?.nativeLockObservedAt;
        if (
          !previousSelection ||
          !["completed", "failed", "cancelled"].includes(previousSelection.state) ||
          !previousEnd ||
          typeof lockStatusAt !== "string" ||
          compareIsoTimestamps(lockStatusAt, previousEnd) < 0
        )
          return;
      }
      for (const targetId of input.candidateIds) {
        if (attemptedIds.has(targetId) || !input.canDispatch(targetId)) continue;
        const targets = [...latest.values()].filter(
          ({ value }) =>
            value.artifactType === "target.object" &&
            value.source.method === "mqtt_area_recon_targets" &&
            value.source.sourceRecordRef === targetId &&
            value.properties &&
            "observationSessionId" in value.properties &&
            value.properties.observationSessionId === missionId &&
            "visibility" in value.properties &&
            value.properties.visibility === "visible",
        );
        const target = targets.length === 1 ? targets[0]?.value : undefined;
        if (!target || (previousEnd && compareIsoTimestamps(target.updatedAt, previousEnd) <= 0))
          continue;
        const requestedAt = this.now().toISOString();
        if (Date.parse(target.updatedAt) - Date.parse(requestedAt) > this.maximumFutureSkewMs)
          continue;
        const actionId = `policy-lock-${createHash("sha256")
          .update(JSON.stringify([execution.externalExecutionId, missionId, targetId]))
          .digest("hex")
          .slice(0, 32)}`;
        action = BusinessActionSchema.parse({
          schemaVersion: "sdar.business-action/1.0-rc2",
          actionId,
          actionType: "sensor.visual_lock",
          identity: scopeBusinessIdentity(scope),
          revision: 1,
          state: "requested",
          actor: { type: "provider", actorId: execution.providerId },
          triggerOrigin: "provider_policy",
          cause: { policyRef: AUTO_LOCK_POLICY },
          reasonCode: "UGV_PROVIDER_VISUAL_LOCK_REQUESTED",
          requestedAt,
          subjectRefs: [{ kind: "artifact", id: target.artifactId, revision: target.revision }],
          properties: {
            observationSessionId: missionId,
            sourceTargetId: targetId,
            phase: "locking",
            policyRef: AUTO_LOCK_POLICY,
            mutationStepId: providerAutoLockStepId(actionId),
          },
        });
        const ref = { kind: "action" as const, id: actionId, revision: 1 };
        const next = TaskBusinessContextSchema.parse({
          ...context,
          contextRevision: context.contextRevision + 1,
          summary: {
            ...context.summary,
            properties: {
              ...context.summary.properties,
              providerAutoLockMissionId: missionId,
              providerAutoLockActionId: actionId,
            },
          },
          activeRefs: { ...context.activeRefs, [key]: ref },
          actionRefs: [...context.actionRefs, ref],
          updatedAt: new Date(
            Math.max(Date.parse(context.updatedAt), Date.parse(requestedAt)),
          ).toISOString(),
        });
        try {
          const committed = await this.business.commitBusinessChangeSet(
            {
              scope,
              expectedContextRevision: context.contextRevision,
              context: next,
              objects: [{ kind: "action", value: action }],
            },
            [actionEvent(action, next.contextRevision, requestedAt)],
          );
          for (const event of committed.events) this.notifyCommitted(event);
          context = next;
        } catch (error) {
          // Another serialized owner/recovery path won. It alone may dispatch.
          if (error instanceof Error && error.message === "BUSINESS_CONTEXT_REVISION_CONFLICT")
            return;
          throw error;
        }
        break;
      }
    }
    if (!action) return;
    const targetId = action.properties?.sourceTargetId;
    if (typeof targetId !== "string") throw new Error("UGV_AUTO_LOCK_TARGET_INVALID");
    const currentExecution = await this.executions.getExecution(execution.taskId);
    if (
      currentExecution?.externalExecutionId !== execution.externalExecutionId ||
      currentExecution.downstreamMissionIds.at(-1) !== missionId ||
      currentExecution.state !== "RUNNING" ||
      currentExecution.preemptedByTaskId !== undefined ||
      input.controlPending()
    ) {
      await this.finish(execution, action, "cancelled", "UGV_AUTO_LOCK_CONTROL_SUPERSEDED");
      return;
    }
    if (this.now().getTime() - Date.parse(action.requestedAt ?? "") >= this.confirmationTimeoutMs) {
      await this.finish(execution, action, "failed", "UGV_AUTO_LOCK_CONFIRMATION_TIMEOUT");
      return;
    }
    const stepId = providerAutoLockStepId(action.actionId);
    const journal = await this.executions.getMutationJournalEntry(execution.taskId, stepId);
    if (journal?.state === "REJECTED") {
      await this.finish(execution, action, "failed", "UGV_AUTO_LOCK_REJECTED");
      return;
    }
    // Dispatching/uncertain calls are never retried. A later bound stage 3 may
    // independently confirm the effect; ACCEPTED itself keeps Action requested.
    if (journal && journal.state !== "INTENT_PERSISTED") return;
    if (!input.canDispatch(targetId)) return;
    try {
      await input.dispatch(stepId, targetId);
    } catch (error) {
      const after = await this.executions.getMutationJournalEntry(execution.taskId, stepId);
      if (
        after?.state === "ACCEPTED" ||
        after?.state === "DISPATCHING" ||
        after?.state === "UNCERTAIN"
      )
        return;
      if (after?.state !== "REJECTED") throw error;
      await this.finish(
        execution,
        action,
        input.controlPending() ? "cancelled" : "failed",
        input.controlPending() ? "UGV_AUTO_LOCK_CONTROL_SUPERSEDED" : "UGV_AUTO_LOCK_REJECTED",
      );
    }
  }

  private async finish(
    execution: ProviderExecution,
    action: BusinessAction,
    state: "cancelled" | "failed",
    reasonCode: string,
  ): Promise<void> {
    const scope = BoundExecutionScope.fromExecution(execution);
    const key = `visualLock:${String(action.properties?.observationSessionId)}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.business.getContext(scope);
      const ref = current?.activeRefs[key];
      if (
        current?.summary.status !== "in_progress" ||
        ref?.kind !== "action" ||
        ref.id !== action.actionId
      )
        return;
      const version = await this.business.getObjectVersion(scope, ref);
      if (version?.kind !== "action" || version.value.state !== "requested") return;
      const endedAt = new Date(
        Math.max(
          this.now().getTime(),
          Date.parse(current.updatedAt),
          Date.parse(version.value.requestedAt ?? ""),
        ),
      ).toISOString();
      const next = BusinessActionSchema.parse({
        ...version.value,
        revision: version.value.revision + 1,
        state,
        reasonCode,
        endReason: reasonCode,
        endedAt,
      });
      const context = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        activeRefs: Object.fromEntries(
          Object.entries(current.activeRefs).filter(([name]) => name !== key),
        ),
        actionRefs: [
          ...current.actionRefs,
          { kind: "action", id: next.actionId, revision: next.revision },
        ],
        updatedAt: endedAt,
      });
      try {
        const committed = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: current.contextRevision,
            context,
            objects: [{ kind: "action", value: next }],
          },
          [actionEvent(next, context.contextRevision, endedAt)],
        );
        for (const event of committed.events) this.notifyCommitted(event);
        return;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "BUSINESS_CONTEXT_REVISION_CONFLICT" ||
          attempt === 2
        )
          throw error;
      }
    }
  }
}

function actionEvent(action: BusinessAction, contextRevision: number, providerRecordedAt: string) {
  return {
    body: TaskBusinessFeedbackBodySchema.parse({
      schemaVersion: "sdar.task-business-feedback/1.0-rc2",
      kind: "ACTION_CHANGED",
      contextRevision,
      providerRecordedAt,
      payload: {
        change: action.revision === 1 ? "create" : "update",
        actionRef: { kind: "action", id: action.actionId, revision: action.revision },
        ...(action.revision === 1 ? {} : { previousRevision: action.revision - 1 }),
        reasonCode: action.reasonCode,
      },
    }),
    description: action.reasonCode,
    reasonCode: action.reasonCode,
    severityHint: "info" as const,
  };
}
