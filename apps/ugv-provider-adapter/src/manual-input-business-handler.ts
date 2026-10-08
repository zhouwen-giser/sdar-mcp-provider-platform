import type { AdapterBusinessEvent } from "../../../packages/adapter-protocol/src/index.js";
import {
  BoundExecutionScope,
  TaskBusinessCommandService,
  taskBusinessCommandRequestHash,
  taskBusinessInputResponseHash,
  type ProviderExecution,
  type TaskBusinessStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
} from "../../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  RequiredInputResponseCommandSchema,
  RequiredInputSchema,
  TrustedResponderSchema,
  type RequiredInput,
} from "../../../packages/vehicle-provider-core/src/task-business-interaction.js";
import { compareIsoTimestamps } from "../../../packages/vehicle-provider-core/src/time.js";

/** Applies only the no-new-device-command continue choice to an observed active lock. */
export class UgvManualInputBusinessHandler {
  constructor(
    readonly business: TaskBusinessStore,
    readonly notifyCommitted: (event: AdapterBusinessEvent) => void,
    readonly now: () => Date = () => new Date(),
  ) {}

  async assertPendingObservation(
    execution: ProviderExecution,
    requestId: string,
  ): Promise<RequiredInput> {
    if (execution.operationName !== "vehicle_area_recon" || !execution.taskBusinessContextExpected)
      throw new Error("UGV_INPUT_EXECUTION_INVALID");
    const scope = BoundExecutionScope.fromExecution(execution);
    const { request } = await this.#currentRequest(scope, requestId);
    await this.#assertCurrentLock(scope, execution, request);
    return request;
  }

  /** Records the elapsed deadline; device release and its confirmation are separate facts. */
  async expireObservation(
    execution: ProviderExecution,
    requestId: string,
  ): Promise<"applied" | "none"> {
    if (execution.operationName !== "vehicle_area_recon" || !execution.taskBusinessContextExpected)
      throw new Error("UGV_INPUT_EXECUTION_INVALID");
    const scope = BoundExecutionScope.fromExecution(execution);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const context = await this.business.getContext(scope);
      const ref = context?.activeRefs["input:visualLock"];
      if (
        context?.summary.status !== "in_progress" ||
        ref?.kind !== "input_request" ||
        ref.id !== requestId
      )
        return "none";
      const version = await this.business.getObjectVersion(scope, ref);
      if (version?.kind !== "input_request" || version.value.state !== "pending") return "none";
      const request = RequiredInputSchema.parse(version.value);
      if (
        !request.deadlineAt ||
        compareIsoTimestamps(this.now().toISOString(), request.deadlineAt) < 0
      )
        throw new Error("UGV_INPUT_DEADLINE_NOT_REACHED");
      const resolvedAt = [this.now().toISOString(), request.requestedAt, context.updatedAt].reduce(
        (latest, candidate) => (compareIsoTimestamps(candidate, latest) > 0 ? candidate : latest),
      );
      const reasonCode = "TARGET_OBSERVATION_DECISION_EXPIRED";
      const expired = RequiredInputSchema.parse({
        ...request,
        revision: request.revision + 1,
        state: "expired",
        reasonCode,
        resolvedAt,
      });
      const nextRef = {
        kind: "input_request" as const,
        id: requestId,
        revision: expired.revision,
      };
      const next = TaskBusinessContextSchema.parse({
        ...context,
        contextRevision: context.contextRevision + 1,
        activeRefs: Object.fromEntries(
          Object.entries(context.activeRefs).filter(([key]) => key !== "input:visualLock"),
        ),
        requiredInputRefs: [...context.requiredInputRefs, nextRef],
        updatedAt: resolvedAt,
      });
      try {
        const committed = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: context.contextRevision,
            context: next,
            objects: [{ kind: "input_request", value: expired }],
          },
          [
            {
              body: TaskBusinessFeedbackBodySchema.parse({
                schemaVersion: "sdar.task-business-feedback/1.0-rc2",
                kind: "REQUIRED_INPUT_CHANGED",
                contextRevision: next.contextRevision,
                providerRecordedAt: resolvedAt,
                payload: {
                  change: "update",
                  requestRef: nextRef,
                  previousRevision: request.revision,
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
        return "applied";
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "BUSINESS_CONTEXT_REVISION_CONFLICT" ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new Error("UGV_INPUT_COMMIT_RETRY_EXHAUSTED");
  }

  async continueObservation(input: {
    execution: ProviderExecution;
    command: unknown;
    responder: unknown;
    runtimeCommandSequence: string;
  }): Promise<"applied" | "duplicate"> {
    const { execution } = input;
    if (
      execution.operationName !== "vehicle_area_recon" ||
      execution.taskBusinessContextExpected !== true
    )
      throw new Error("UGV_INPUT_EXECUTION_INVALID");
    const command = RequiredInputResponseCommandSchema.parse(input.command);
    const responder = TrustedResponderSchema.parse(input.responder);
    if (
      (responder.source !== "runtime_development_policy" && responder.actorType !== "user") ||
      command.result.action !== "accept" ||
      command.result.value === undefined
    )
      throw new Error("UGV_INPUT_DECISION_NOT_SUPPORTED");
    const scope = BoundExecutionScope.fromExecution(execution);
    if (command.taskId !== scope.taskId || command.executionId !== scope.executionId)
      throw new Error("UGV_INPUT_COMMAND_BINDING_INVALID");
    const replay = await this.business.getCommand(scope, command.commandId);
    if (replay) {
      if (
        replay.commandType !== "input_response" ||
        replay.entryKey !== `input:${command.requestKey}` ||
        replay.runtimeCommandSequence !== input.runtimeCommandSequence ||
        replay.requestHash !== taskBusinessCommandRequestHash(command) ||
        replay.responseHash !== taskBusinessInputResponseHash(command.result)
      )
        throw new Error("COMMAND_ID_CONFLICT");
      if (replay.state === "applied") return "duplicate";
    }
    if (execution.state !== "WAITING_INPUT") throw new Error("UGV_INPUT_EXECUTION_NOT_WAITING");
    const commands = new TaskBusinessCommandService(this.business, this.now);
    const initial = await this.#currentRequest(scope, command.requestId);
    await this.#assertCurrentLock(scope, execution, initial.request);
    const claimed = await commands.submitInputResponse({
      scope,
      command,
      responder,
      currentSubjectBinding: initial.request.subjectBinding,
      runtimeCommandSequence: input.runtimeCommandSequence,
    });
    if (!claimed.claimed && claimed.record.state === "applied") return "duplicate";
    if (claimed.record.state !== "accepted") throw new Error("UGV_INPUT_COMMAND_NOT_ACCEPTED");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { context, request } = await this.#currentRequest(scope, command.requestId);
      await this.#assertCurrentLock(scope, execution, request);
      const resolvedAt = this.now().toISOString();
      const answered = RequiredInputSchema.parse({
        ...request,
        revision: request.revision + 1,
        state: "answered",
        reasonCode: "TARGET_OBSERVATION_CONTINUES",
        resolvedAt,
        responseCommandId: command.commandId,
        response: command.result,
      });
      const ref = {
        kind: "input_request" as const,
        id: answered.requestId,
        revision: answered.revision,
      };
      const activeRefs = Object.fromEntries(
        Object.entries(context.activeRefs).filter(([, active]) => active.kind !== "input_request"),
      );
      const next = TaskBusinessContextSchema.parse({
        ...context,
        contextRevision: context.contextRevision + 1,
        activeRefs,
        requiredInputRefs: [...context.requiredInputRefs, ref],
        updatedAt:
          compareIsoTimestamps(resolvedAt, context.updatedAt) >= 0 ? resolvedAt : context.updatedAt,
      });
      const reasonCode = "TARGET_OBSERVATION_CONTINUES";
      try {
        const committed = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: context.contextRevision,
            context: next,
            objects: [{ kind: "input_request", value: answered }],
            command: {
              ...claimed.record,
              state: "applied",
              resultCode: reasonCode,
              resultRefs: [ref],
              updatedAt: resolvedAt,
            },
          },
          [
            {
              body: TaskBusinessFeedbackBodySchema.parse({
                schemaVersion: "sdar.task-business-feedback/1.0-rc2",
                kind: "REQUIRED_INPUT_CHANGED",
                contextRevision: next.contextRevision,
                providerRecordedAt: resolvedAt,
                payload: {
                  change: "update",
                  requestRef: ref,
                  previousRevision: request.revision,
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
        return "applied";
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "BUSINESS_CONTEXT_REVISION_CONFLICT" ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new Error("UGV_INPUT_COMMIT_RETRY_EXHAUSTED");
  }

  /** A decline or dismissal is admitted before the journaled device release. */
  async releaseObservation(input: {
    execution: ProviderExecution;
    command: unknown;
    responder: unknown;
    runtimeCommandSequence: string;
    release: (request: RequiredInput) => Promise<void>;
  }): Promise<"applied" | "duplicate"> {
    const { execution } = input;
    if (execution.operationName !== "vehicle_area_recon" || !execution.taskBusinessContextExpected)
      throw new Error("UGV_INPUT_EXECUTION_INVALID");
    const command = RequiredInputResponseCommandSchema.parse(input.command);
    const responder = TrustedResponderSchema.parse(input.responder);
    if (
      (responder.source !== "runtime_development_policy" && responder.actorType !== "user") ||
      !["decline", "cancel"].includes(command.result.action) ||
      command.result.value !== undefined
    )
      throw new Error("UGV_INPUT_DECISION_NOT_SUPPORTED");
    const scope = BoundExecutionScope.fromExecution(execution);
    if (command.taskId !== scope.taskId || command.executionId !== scope.executionId)
      throw new Error("UGV_INPUT_COMMAND_BINDING_INVALID");
    const replay = await this.business.getCommand(scope, command.commandId);
    if (replay) {
      if (
        replay.commandType !== "input_response" ||
        replay.entryKey !== `input:${command.requestKey}` ||
        replay.runtimeCommandSequence !== input.runtimeCommandSequence ||
        replay.requestHash !== taskBusinessCommandRequestHash(command) ||
        replay.responseHash !== taskBusinessInputResponseHash(command.result)
      )
        throw new Error("COMMAND_ID_CONFLICT");
      if (replay.state === "applied") return "duplicate";
      if (replay.state === "rejected") throw new Error(replay.resultCode);
    }
    if (execution.state !== "WAITING_INPUT") throw new Error("UGV_INPUT_EXECUTION_NOT_WAITING");
    const initial = await this.#currentRequest(scope, command.requestId);
    await this.#assertCurrentLock(scope, execution, initial.request);
    const disposition =
      command.result.action === "cancel" ? initial.request.onDismiss : initial.request.onDecline;
    if (disposition !== "release_and_resume_scan")
      throw new Error("UGV_INPUT_DISPOSITION_NOT_SUPPORTED");
    const claimed = await new TaskBusinessCommandService(
      this.business,
      this.now,
    ).submitInputResponse({
      scope,
      command,
      responder,
      currentSubjectBinding: initial.request.subjectBinding,
      runtimeCommandSequence: input.runtimeCommandSequence,
    });
    if (!claimed.claimed && claimed.record.state === "applied") return "duplicate";
    if (claimed.record.state !== "accepted") throw new Error(claimed.record.resultCode);
    await input.release(initial.request);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { context, request } = await this.#currentRequest(scope, command.requestId);
      await this.#assertCurrentLock(scope, execution, request);
      const resolvedAt = [this.now().toISOString(), context.updatedAt, request.requestedAt].reduce(
        (latest, candidate) => (compareIsoTimestamps(candidate, latest) > 0 ? candidate : latest),
      );
      const reasonCode =
        command.result.action === "cancel"
          ? "TARGET_OBSERVATION_DISMISSED"
          : "TARGET_OBSERVATION_DECLINED";
      const resolved = RequiredInputSchema.parse({
        ...request,
        revision: request.revision + 1,
        state: command.result.action === "cancel" ? "cancelled" : "declined",
        reasonCode,
        resolvedAt,
        responseCommandId: command.commandId,
        response: command.result,
      });
      const ref = {
        kind: "input_request" as const,
        id: request.requestId,
        revision: resolved.revision,
      };
      const next = TaskBusinessContextSchema.parse({
        ...context,
        contextRevision: context.contextRevision + 1,
        activeRefs: Object.fromEntries(
          Object.entries(context.activeRefs).filter(([key]) => key !== "input:visualLock"),
        ),
        requiredInputRefs: [...context.requiredInputRefs, ref],
        updatedAt: resolvedAt,
      });
      try {
        const committed = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: context.contextRevision,
            context: next,
            objects: [{ kind: "input_request", value: resolved }],
            command: {
              ...claimed.record,
              state: "applied",
              resultCode: reasonCode,
              resultRefs: [ref],
              updatedAt: resolvedAt,
            },
          },
          [
            {
              body: TaskBusinessFeedbackBodySchema.parse({
                schemaVersion: "sdar.task-business-feedback/1.0-rc2",
                kind: "REQUIRED_INPUT_CHANGED",
                contextRevision: next.contextRevision,
                providerRecordedAt: resolvedAt,
                payload: {
                  change: "update",
                  requestRef: ref,
                  previousRevision: request.revision,
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
        return "applied";
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "BUSINESS_CONTEXT_REVISION_CONFLICT" ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new Error("UGV_INPUT_COMMIT_RETRY_EXHAUSTED");
  }

  /** Records a definite refusal while leaving the original prompt available. */
  async rejectReleaseCommand(execution: ProviderExecution, commandId: string, resultCode: string) {
    const scope = BoundExecutionScope.fromExecution(execution);
    const command = await this.business.getCommand(scope, commandId);
    if (command?.commandType !== "input_response")
      throw new Error("BUSINESS_COMMAND_CLAIM_REQUIRED");
    if (command.state === "rejected") return;
    if (command.state !== "accepted") throw new Error("BUSINESS_COMMAND_TRANSITION_INVALID");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const context = await this.business.getContext(scope);
      if (context?.summary.status !== "in_progress")
        throw new Error("BUSINESS_CONTEXT_NOT_AVAILABLE");
      const timestamp = this.now().toISOString();
      const updatedAt =
        compareIsoTimestamps(timestamp, context.updatedAt) >= 0 ? timestamp : context.updatedAt;
      const next = TaskBusinessContextSchema.parse({
        ...context,
        contextRevision: context.contextRevision + 1,
        updatedAt,
      });
      try {
        await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: context.contextRevision,
            context: next,
            objects: [],
            command: { ...command, state: "rejected", resultCode, updatedAt },
          },
          [],
        );
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
    throw new Error("UGV_INPUT_COMMIT_RETRY_EXHAUSTED");
  }

  async #currentRequest(
    scope: BoundExecutionScope,
    requestId: string,
  ): Promise<{
    context: NonNullable<Awaited<ReturnType<TaskBusinessStore["getContext"]>>>;
    request: RequiredInput;
  }> {
    const context = await this.business.getContext(scope);
    const ref =
      context &&
      Object.values(context.activeRefs).find(
        (item) => item.kind === "input_request" && item.id === requestId,
      );
    if (!context || !ref || context.summary.status !== "in_progress")
      throw new Error("UGV_INPUT_REQUEST_NOT_CURRENT");
    const version = await this.business.getObjectVersion(scope, ref);
    if (version?.kind !== "input_request" || version.value.state !== "pending")
      throw new Error("UGV_INPUT_REQUEST_NOT_CURRENT");
    return { context, request: RequiredInputSchema.parse(version.value) };
  }

  async #assertCurrentLock(
    scope: BoundExecutionScope,
    execution: ProviderExecution,
    request: RequiredInput,
  ): Promise<void> {
    const missionId = execution.downstreamMissionIds.at(-1);
    const binding = request.subjectBinding;
    if (
      missionId === undefined ||
      binding.kind !== "visual_lock" ||
      request.identity.taskId !== scope.taskId ||
      request.identity.executionId !== scope.executionId ||
      request.identity.providerId !== scope.providerId ||
      request.identity.resourceId !== scope.resourceId ||
      request.identity.operationName !== execution.operationName
    )
      throw new Error("UGV_INPUT_SUBJECT_NOT_CURRENT");
    const context = await this.business.getContext(scope);
    const active = context?.activeRefs[`visualLock:${missionId}`];
    if (active?.kind !== "action" || active.id !== binding.lockSessionId)
      throw new Error("UGV_INPUT_SUBJECT_NOT_CURRENT");
    const version = await this.business.getObjectVersion(scope, active);
    if (
      version?.kind !== "action" ||
      version.value.state !== "active" ||
      version.value.actionType !== "sensor.visual_lock" ||
      version.value.properties?.phase !== "observing" ||
      version.value.properties.sourceTargetId !== binding.targetId
    )
      throw new Error("UGV_INPUT_SUBJECT_NOT_CURRENT");
  }
}
