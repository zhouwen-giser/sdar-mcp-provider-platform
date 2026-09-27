import { describe, expect, it } from "vitest";
import { NativeLockBusinessProcessor } from "../../apps/ugv-provider-adapter/src/native-lock-business-processor.js";
import { UgvManualInputBusinessHandler } from "../../apps/ugv-provider-adapter/src/manual-input-business-handler.js";
import { TargetBusinessProcessor } from "../../apps/ugv-provider-adapter/src/target-business-processor.js";
import {
  UGV_RECON_BUSINESS_PROFILE,
  UgvTaskBusinessContextService,
} from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import {
  BoundExecutionScope,
  MemoryProviderStore,
  MemoryTaskBusinessStore,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";

const at = "2026-09-24T00:00:00Z";

function execution(): ProviderExecution {
  return {
    taskId: "task-native-lock",
    externalExecutionId: "execution-native-lock",
    operationName: "vehicle_area_recon",
    argumentHash: "b".repeat(64),
    providerId: "provider-a",
    resourceId: "vehicle:ugv1",
    tracks: [],
    arguments: { resourceId: "vehicle:ugv1", scanMode: "circular" },
    executionContext: {
      authorizationContextHash: "a".repeat(64),
      executionMode: "SIMULATION",
      simulationId: "scene-a",
      correlationId: "correlation-a",
    },
    taskBusinessContextExpected: true,
    downstreamMissionIds: ["mission-1"],
    state: "RUNNING",
    revision: 2,
    reasonCode: "UGV_RECON_RUNNING",
    createdAt: at,
    updatedAt: at,
    evidence: [],
  };
}

function fact(second: number, stage: 1 | 2 | 3 | 4, targetId?: string, motionStatus = 5) {
  return {
    schemaVersion: "ugv.recon-native-lock-fact/1",
    missionId: "mission-1",
    sourceCursor: `cursor-${second}-${stage}`,
    observedAt: `2026-09-24T00:00:0${second}Z`,
    stage,
    ...(targetId === undefined ? {} : { targetId }),
    motionStatus,
  };
}

async function setup() {
  const run = execution();
  const executions = new MemoryProviderStore();
  const business = new MemoryTaskBusinessStore();
  await executions.putExecution(run);
  const service = new UgvTaskBusinessContextService(
    executions,
    business,
    run.providerId ?? "provider-a",
    run.resourceId,
    () => undefined,
  );
  await service.ensureForCreatedExecution(run.taskId);
  const events: unknown[] = [];
  const processor = new NativeLockBusinessProcessor(business, (event) => events.push(event));
  const targets = new TargetBusinessProcessor(business, () => undefined);
  return {
    run,
    business,
    service,
    processor,
    targets,
    events,
    scope: BoundExecutionScope.fromExecution(run),
  };
}

describe("native UGV lock observation projector", () => {
  it("durably applies an authorized continue decision to the current lock session", async () => {
    const { run, business, scope, service } = await setup();
    const now = () => new Date("2026-09-24T00:00:04Z");
    const producer = new NativeLockBusinessProcessor(business, () => undefined, {
      maxWaitMs: 30_000,
      onExpire: "release_and_resume_scan",
      onDismiss: "release_and_resume_scan",
      now,
    });
    await producer.apply(run, fact(1, 3, "7"));
    const request = await service.activeRequiredInput(run);
    if (!request) throw new Error("PENDING_INPUT_MISSING");
    const command = {
      schemaVersion: "sdar.required-input-response/1.0-rc2",
      commandId: "continue-command-1",
      taskId: run.taskId,
      executionId: run.externalExecutionId,
      requestId: request.requestId,
      requestKey: request.requestKey,
      guard: { mode: "semantic", expectedRequestRevision: request.revision },
      result: { action: "accept", value: { decision: "continue_observation" } },
    };
    const handler = new UgvManualInputBusinessHandler(business, () => undefined, now);
    const input = {
      execution: { ...run, state: "WAITING_INPUT" as const },
      command,
      responder: {
        source: "runtime_authorization_context",
        actorType: "user",
        verified: true,
      },
      runtimeCommandSequence: "11",
    };
    expect(await handler.continueObservation(input)).toBe("applied");
    expect(await handler.continueObservation(input)).toBe("duplicate");
    expect(await service.activeRequiredInput(run)).toBeUndefined();
    const context = await business.getContext(scope);
    expect(context?.activeRefs["input:visualLock"]).toBeUndefined();
    const ref = context?.requiredInputRefs.at(-1);
    if (!ref) throw new Error("ANSWERED_INPUT_REF_MISSING");
    expect(await business.getObjectVersion(scope, ref)).toMatchObject({
      kind: "input_request",
      value: { state: "answered", responseCommandId: command.commandId },
    });
    expect(await business.getCommand(scope, command.commandId)).toMatchObject({
      state: "applied",
      resultCode: "TARGET_OBSERVATION_CONTINUES",
    });
  });
  it("creates one session-bound manual request and cancels it when the observed lock ends", async () => {
    const { run, business, scope, service } = await setup();
    const processor = new NativeLockBusinessProcessor(business, () => undefined, {
      maxWaitMs: 30_000,
      onExpire: "release_and_resume_scan",
      onDismiss: "release_and_resume_scan",
      now: () => new Date("2026-09-24T00:00:04Z"),
    });
    await processor.apply(run, fact(1, 3, "7"));
    const first = await service.activeRequiredInput(run);
    expect(first).toMatchObject({
      state: "pending",
      inputType: "target.disposition_decision",
      subjectBinding: { kind: "visual_lock", targetId: "7" },
      deadlineAt: "2026-09-24T00:00:31.000Z",
    });
    await processor.apply(run, fact(2, 3, "7"));
    expect((await business.getContext(scope))?.requiredInputRefs).toHaveLength(1);
    expect((await service.activeRequiredInput(run))?.requestId).toBe(first?.requestId);

    await processor.apply(run, fact(3, 1));
    expect(await service.activeRequiredInput(run)).toBeUndefined();
    const refs = (await business.getContext(scope))?.requiredInputRefs;
    expect(refs).toHaveLength(2);
    if (!refs?.[1]) throw new Error("CANCELLED_INPUT_REF_MISSING");
    expect(await business.getObjectVersion(scope, refs[1])).toMatchObject({
      kind: "input_request",
      value: { requestId: first?.requestId, revision: 2, state: "cancelled" },
    });
    await processor.apply(run, fact(4, 3, "7"));
    const next = await service.activeRequiredInput(run);
    expect(next?.requestId).toBeDefined();
    expect(next?.requestId).not.toBe(first?.requestId);
  });

  it("cancels the old request when a different target replaces the lock", async () => {
    const { run, business, scope, service } = await setup();
    const processor = new NativeLockBusinessProcessor(business, () => undefined, {
      maxWaitMs: 30_000,
      onExpire: "release_and_resume_scan",
      onDismiss: "release_and_resume_scan",
      now: () => new Date("2026-09-24T00:00:04Z"),
    });
    await processor.apply(run, fact(1, 3, "7"));
    const first = await service.activeRequiredInput(run);
    await processor.apply(run, fact(2, 2, "8"));
    expect(await service.activeRequiredInput(run)).toBeUndefined();
    await processor.apply(run, fact(3, 3, "8"));
    const next = await service.activeRequiredInput(run);
    expect(next?.requestId).not.toBe(first?.requestId);
    expect(next?.subjectBinding).toMatchObject({ kind: "visual_lock", targetId: "8" });
    expect((await business.getContext(scope))?.requiredInputRefs).toHaveLength(3);
  });

  it("invalidates a prompt after an explicit target-loss fact without claiming device release", async () => {
    const { run, business, scope, service, targets } = await setup();
    const producer = new NativeLockBusinessProcessor(business, () => undefined, {
      maxWaitMs: 30_000,
      onExpire: "release_and_resume_scan",
      onDismiss: "release_and_resume_scan",
      now: () => new Date("2026-09-24T00:00:05Z"),
    });
    const visible = {
      schemaVersion: "ugv.recon-target-fact/1",
      missionId: "mission-1",
      observationSessionId: "mission-1",
      sensorId: "ugv.area_recon.targets",
      sourceTargetId: "7",
      sourceRevision: "capture-1",
      observedAt: "2026-09-24T00:00:01Z",
      visibility: "visible",
      trackingState: "unknown",
      location: { longitude: 116, latitude: 39 },
    };
    await targets.apply(run, visible);
    await producer.apply(run, fact(2, 3, "7"));
    expect(await service.activeRequiredInput(run)).toBeDefined();
    await targets.apply(run, {
      ...visible,
      sourceRevision: "capture-3",
      observedAt: "2026-09-24T00:00:03Z",
      visibility: "lost",
      trackingState: "lost",
      location: undefined,
    });
    await producer.apply(run, fact(4, 3, "7"));
    expect(await service.activeRequiredInput(run)).toBeUndefined();
    const context = await business.getContext(scope);
    expect(context?.activeRefs["visualLock:mission-1"]).toBeDefined();
    const last = context?.requiredInputRefs.at(-1);
    if (!last) throw new Error("CANCELLED_INPUT_REF_MISSING");
    expect(await business.getObjectVersion(scope, last)).toMatchObject({
      kind: "input_request",
      value: { state: "cancelled", reasonCode: "TARGET_LOST_DURING_OBSERVATION" },
    });
  });

  it("retires a pending prompt directly on qualified target loss without another lock status", async () => {
    const { run, business, scope, service, targets } = await setup();
    const producer = new NativeLockBusinessProcessor(business, () => undefined, {
      maxWaitMs: 30_000,
      onExpire: "release_and_resume_scan",
      onDismiss: "release_and_resume_scan",
      now: () => new Date("2026-09-24T00:00:05Z"),
    });
    const visible = {
      schemaVersion: "ugv.recon-target-fact/1",
      missionId: "mission-1",
      observationSessionId: "mission-1",
      sensorId: "ugv.area_recon.targets",
      sourceTargetId: "7",
      sourceRevision: "capture-1",
      observedAt: "2026-09-24T00:00:01Z",
      visibility: "visible" as const,
      trackingState: "unknown",
    };
    await targets.apply(run, visible);
    await producer.apply(run, fact(2, 3, "7"));
    expect(await service.activeRequiredInput(run)).toBeDefined();
    await targets.apply(run, {
      ...visible,
      sourceRevision: "capture-3",
      observedAt: "2026-09-24T00:00:03Z",
      visibility: "lost",
      trackingState: "lost",
    });
    expect(await producer.invalidateForTargetLoss(run, "7")).toBe("committed");
    expect(await producer.invalidateForTargetLoss(run, "7")).toBe("none");
    expect(await service.activeRequiredInput(run)).toBeUndefined();
    const context = await business.getContext(scope);
    expect(context?.activeRefs["visualLock:mission-1"]).toBeDefined();
    const resolved = context?.requiredInputRefs.at(-1);
    if (!resolved) throw new Error("CANCELLED_INPUT_REF_MISSING");
    expect(await business.getObjectVersion(scope, resolved)).toMatchObject({
      kind: "input_request",
      value: { state: "cancelled", reasonCode: "TARGET_LOST_DURING_OBSERVATION" },
    });
  });

  it("publishes a cancelled input revision with terminal Context finalization", async () => {
    const { run, business, scope, service } = await setup();
    const producer = new NativeLockBusinessProcessor(business, () => undefined, {
      maxWaitMs: 30_000,
      onExpire: "release_and_resume_scan",
      onDismiss: "release_and_resume_scan",
      now: () => new Date("2026-09-24T00:00:04Z"),
    });
    await producer.apply(run, fact(1, 3, "7"));
    expect(await service.activeRequiredInput(run)).toBeDefined();
    const terminal = {
      ...run,
      state: "CANCELLED" as const,
      revision: run.revision + 1,
      reasonCode: "UGV_TASK_CANCELLED",
      updatedAt: "2026-09-24T00:00:05Z",
      terminalAt: "2026-09-24T00:00:05Z",
    };
    await service.finalizeForTerminalExecution(terminal);
    await service.finalizeForTerminalExecution(terminal);
    const context = await business.getContext(scope);
    expect(context?.summary.status).toBe("finalized");
    expect(context?.activeRefs).toEqual({});
    expect(context?.summary.properties?.unresolvedRefs).toEqual([
      expect.objectContaining({ kind: "action" }),
    ]);
    const resolved = context?.requiredInputRefs.at(-1);
    if (!resolved) throw new Error("TERMINAL_INPUT_REF_MISSING");
    expect(await business.getObjectVersion(scope, resolved)).toMatchObject({
      kind: "input_request",
      value: { state: "cancelled", reasonCode: "INPUT_EXECUTION_TERMINATED" },
    });
    expect(context?.requiredInputRefs).toHaveLength(2);
  });

  it("projects a delayed lock observation without issuing an expired prompt", async () => {
    const { run, business, scope, service } = await setup();
    const processor = new NativeLockBusinessProcessor(business, () => undefined, {
      maxWaitMs: 1_000,
      onExpire: "release_and_resume_scan",
      onDismiss: "release_and_resume_scan",
      now: () => new Date("2026-09-24T00:00:05Z"),
    });
    await processor.apply(run, fact(1, 3, "7"));
    expect(await service.activeRequiredInput(run)).toBeUndefined();
    expect((await business.getContext(scope))?.actionRefs).toHaveLength(1);
  });

  it("does not link a target captured after a delayed lock observation", async () => {
    const { run, business, processor, targets, scope } = await setup();
    await targets.apply(run, {
      schemaVersion: "ugv.recon-target-fact/1",
      missionId: "mission-1",
      observationSessionId: "mission-1",
      sensorId: "ugv.area_recon.targets",
      sourceTargetId: "7",
      sourceRevision: "capture-4",
      observedAt: "2026-09-24T00:00:04Z",
      visibility: "visible",
      trackingState: "unknown",
      location: { longitude: 116, latitude: 39 },
    });
    expect(await processor.apply(run, fact(3, 3, "7"))).toBe("committed");
    let snapshot = await business.getContextSnapshot(scope);
    const first = snapshot?.objects.find((item) => item.kind === "action");
    expect(first).toMatchObject({
      kind: "action",
      value: { state: "active", startedAt: "2026-09-24T00:00:03Z" },
    });
    if (first?.kind !== "action") throw new Error("ACTION_MISSING");
    expect(first.value.subjectRefs).toBeUndefined();

    expect(await processor.apply(run, fact(5, 3, "7"))).toBe("committed");
    snapshot = await business.getContextSnapshot(scope);
    const current = snapshot?.objects.find(
      (item) => item.kind === "action" && item.value.revision === 2,
    );
    expect(current).toMatchObject({
      kind: "action",
      value: { subjectRefs: [{ kind: "artifact" }] },
    });
  });

  it("does not link a lock to a historically visible but now lost target", async () => {
    const { run, business, targets, scope, service } = await setup();
    const processor = new NativeLockBusinessProcessor(business, () => undefined, {
      maxWaitMs: 30_000,
      onExpire: "release_and_resume_scan",
      onDismiss: "release_and_resume_scan",
      now: () => new Date("2026-09-24T00:00:04Z"),
    });
    const visible = {
      schemaVersion: "ugv.recon-target-fact/1",
      missionId: "mission-1",
      observationSessionId: "mission-1",
      sensorId: "ugv.area_recon.targets",
      sourceTargetId: "7",
      sourceRevision: "capture-1",
      observedAt: "2026-09-24T00:00:01Z",
      visibility: "visible",
      trackingState: "unknown",
      location: { longitude: 116, latitude: 39 },
    };
    await targets.apply(run, visible);
    await targets.apply(run, {
      ...visible,
      sourceRevision: "capture-2",
      observedAt: "2026-09-24T00:00:02Z",
      visibility: "lost",
      trackingState: "lost",
    });
    const history = (await business.getContextSnapshot(scope))?.objects.filter(
      (item) => item.kind === "artifact" && item.value.artifactType === "target.object",
    );
    expect(history).toHaveLength(2);
    expect(await processor.apply(run, fact(3, 3, "7"))).toBe("committed");
    const action = (await business.getContextSnapshot(scope))?.objects.find(
      (item) => item.kind === "action",
    );
    expect(action).toMatchObject({ kind: "action", value: { state: "active" } });
    if (action?.kind !== "action") throw new Error("ACTION_MISSING");
    expect(action.value.subjectRefs).toBeUndefined();
    expect(await service.activeRequiredInput(run)).toBeUndefined();
  });

  it("does not create a prompt for a delayed lock fact after a newer target-loss fact", async () => {
    const { run, business, targets, service } = await setup();
    const processor = new NativeLockBusinessProcessor(business, () => undefined, {
      maxWaitMs: 30_000,
      onExpire: "release_and_resume_scan",
      onDismiss: "release_and_resume_scan",
      now: () => new Date("2026-09-24T00:00:05Z"),
    });
    const visible = {
      schemaVersion: "ugv.recon-target-fact/1",
      missionId: "mission-1",
      observationSessionId: "mission-1",
      sensorId: "ugv.area_recon.targets",
      sourceTargetId: "7",
      sourceRevision: "capture-1",
      observedAt: "2026-09-24T00:00:01Z",
      visibility: "visible" as const,
      trackingState: "unknown",
    };
    await targets.apply(run, visible);
    await targets.apply(run, {
      ...visible,
      sourceRevision: "capture-4",
      observedAt: "2026-09-24T00:00:04Z",
      visibility: "lost",
      trackingState: "lost",
    });
    expect(await processor.apply(run, fact(3, 3, "7"))).toBe("committed");
    expect(await service.activeRequiredInput(run)).toBeUndefined();
  });

  it("does not choose an arbitrary target when source IDs collide across sensors", async () => {
    const { run, business, processor, targets, scope } = await setup();
    const visible = {
      schemaVersion: "ugv.recon-target-fact/1",
      missionId: "mission-1",
      observationSessionId: "mission-1",
      sourceTargetId: "7",
      sourceRevision: "capture-1",
      observedAt: "2026-09-24T00:00:01Z",
      visibility: "visible",
      trackingState: "unknown",
      location: { longitude: 116, latitude: 39 },
    };
    await targets.apply(run, { ...visible, sensorId: "sensor-a" });
    await targets.apply(run, { ...visible, sensorId: "sensor-b" });
    expect(await processor.apply(run, fact(2, 3, "7"))).toBe("committed");
    const action = (await business.getContextSnapshot(scope))?.objects.find(
      (item) => item.kind === "action",
    );
    if (action?.kind !== "action") throw new Error("ACTION_MISSING");
    expect(action.value.subjectRefs).toBeUndefined();
  });

  it("rejects historical mission and pre-execution lock stages before creating an Action", async () => {
    const { run, business, processor, events, scope } = await setup();
    const replacement = { ...run, downstreamMissionIds: ["mission-1", "mission-2"] };
    const current = { ...fact(2, 3, "7"), missionId: "mission-2" };
    await expect(processor.apply(replacement, fact(2, 3, "7"))).rejects.toThrow(
      "NATIVE_LOCK_EXECUTION_BINDING_INVALID",
    );
    await expect(
      processor.apply(replacement, { ...current, observedAt: "2026-09-23T23:59:59Z" }),
    ).rejects.toThrow("NATIVE_LOCK_EXECUTION_BINDING_INVALID");
    expect((await business.getContext(scope))?.actionRefs).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(await processor.apply(replacement, current)).toBe("committed");
  });

  it("archives a terminal recon Context without inventing physical lock release", async () => {
    const { run, business, service, processor, scope } = await setup();
    await processor.apply(run, fact(1, 3, "7"));
    const lockRef = (await business.getContext(scope))?.activeRefs["visualLock:mission-1"];
    if (!lockRef) throw new Error("ACTIVE_LOCK_REF_MISSING");
    await service.finalizeForTerminalExecution({
      ...run,
      state: "TECHNICAL_FAILED",
      reasonCode: "UGV_RECON_TIMEOUT",
      terminalAt: "2026-09-24T00:00:02Z",
      updatedAt: "2026-09-24T00:00:02Z",
    });
    expect(await business.getContext(scope)).toMatchObject({
      summary: {
        status: "finalized",
        resultCode: "UGV_RECON_TIMEOUT",
        properties: { unresolvedRefs: [lockRef] },
      },
      activeRefs: {},
    });
    const lock = await business.getObjectVersion(scope, lockRef);
    expect(lock).toMatchObject({ value: { state: "active" } });
    expect(lock?.kind === "action" && "endedAt" in lock.value).toBe(false);
  });
  it("advertises observed lock Actions without claiming automatic owner qualification", () => {
    expect(UGV_RECON_BUSINESS_PROFILE.actionTypes).toContain("sensor.visual_lock");
    expect(UGV_RECON_BUSINESS_PROFILE.policy.visualLockOwner).toBe("disabled");
    expect(UGV_RECON_BUSINESS_PROFILE.qualification.automaticVisualLock).toBe("not_supported");
  });
  it("observes active directly without inventing a request and links the target Artifact", async () => {
    const { run, business, processor, targets, events, scope } = await setup();
    await targets.apply(run, {
      schemaVersion: "ugv.recon-target-fact/1",
      missionId: "mission-1",
      observationSessionId: "mission-1",
      sensorId: "ugv.area_recon.targets",
      sourceTargetId: "7",
      sourceRevision: "capture-1",
      observedAt: "2026-09-24T00:00:01Z",
      visibility: "visible",
      trackingState: "unknown",
      location: { longitude: 116, latitude: 39 },
    });
    expect(await processor.apply(run, fact(2, 1))).toBe("committed");
    expect(await processor.apply(run, fact(3, 2, "7"))).toBe("committed");
    let snapshot = await business.getContextSnapshot(scope);
    const first = snapshot?.objects.find((item) => item.kind === "action");
    expect(first).toMatchObject({
      kind: "action",
      value: {
        actionType: "sensor.visual_lock",
        revision: 1,
        state: "active",
        actor: { type: "device" },
        triggerOrigin: "unknown",
        startedAt: "2026-09-24T00:00:03Z",
        properties: { phase: "locking", sourceTargetId: "7", triggerQualification: "unverified" },
        subjectRefs: [{ kind: "artifact" }],
      },
    });
    if (first?.kind !== "action") throw new Error("ACTION_MISSING");
    expect("requestedAt" in first.value).toBe(false);
    expect(events).toHaveLength(1);
    expect(await processor.apply(run, fact(4, 3, "7"))).toBe("committed");
    expect(await processor.apply(run, fact(4, 3, "7"))).toBe("duplicate");
    const latest = await business.getObjectVersion(scope, {
      kind: "action",
      id: first.value.actionId,
      revision: 2,
    });
    expect(latest).toMatchObject({
      value: {
        state: "active",
        startedAt: "2026-09-24T00:00:03Z",
        properties: { phase: "observing", nativeLockStage: 3 },
      },
    });
    expect(await processor.apply(run, fact(5, 4, "7"))).toBe("committed");
    snapshot = await business.getContextSnapshot(scope);
    expect(snapshot?.context.activeRefs["visualLock:mission-1"]).toMatchObject({ revision: 2 });
    expect(snapshot?.context.summary.properties).toMatchObject({
      nativeLockObservedAt: "2026-09-24T00:00:05Z",
    });
    expect(events).toHaveLength(2);
  });

  it("ends unknown release, observation end and failure with distinct reasons", async () => {
    const { run, business, processor, scope } = await setup();
    await processor.apply(run, fact(1, 3, "7"));
    expect(await processor.apply(run, fact(2, 1))).toBe("committed");
    expect((await business.getContext(scope))?.activeRefs["visualLock:mission-1"]).toBeUndefined();
    let snapshot = await business.getContextSnapshot(scope);
    expect(
      snapshot?.objects.find((item) => item.kind === "action" && item.value.revision === 2),
    ).toMatchObject({
      value: { state: "completed", endReason: "VISUAL_LOCK_END_CAUSE_UNKNOWN" },
    });
    await processor.apply(run, fact(3, 3, "7"));
    await processor.apply(run, fact(4, 1, undefined, 11));
    snapshot = await business.getContextSnapshot(scope);
    expect(
      snapshot?.objects.find(
        (item) => item.kind === "action" && item.value.endReason === "OBSERVATION_ENDED",
      ),
    ).toBeDefined();
    await processor.apply(run, fact(5, 3, "7"));
    await processor.apply(run, fact(6, 1, undefined, 10));
    snapshot = await business.getContextSnapshot(scope);
    expect(
      snapshot?.objects.find(
        (item) => item.kind === "action" && item.value.endReason === "RECON_FAILED",
      ),
    ).toMatchObject({ value: { state: "failed" } });
  });

  it("does not merge a new target with the previous lock Action", async () => {
    const { run, business, processor, scope, events } = await setup();
    await processor.apply(run, fact(1, 3, "7"));
    const oldRef = (await business.getContext(scope))?.activeRefs["visualLock:mission-1"];
    expect(await processor.apply(run, fact(2, 3, "9"))).toBe("committed");
    const newRef = (await business.getContext(scope))?.activeRefs["visualLock:mission-1"];
    expect(newRef?.id).not.toBe(oldRef?.id);
    expect(
      await business.getObjectVersion(scope, { kind: "action", id: oldRef?.id ?? "", revision: 2 }),
    ).toMatchObject({ value: { endReason: "VISUAL_LOCK_REPLACED" } });
    expect(events).toHaveLength(3);
  });

  it("keeps a released lock closed against an older delayed stage", async () => {
    const { run, business, processor, events, scope } = await setup();
    expect(await processor.apply(run, fact(1, 2, "7"))).toBe("committed");
    expect(await processor.apply(run, fact(4, 1))).toBe("committed");
    const released = await business.getContext(scope);
    const eventCount = events.length;
    expect(released?.activeRefs["visualLock:mission-1"]).toBeUndefined();
    expect(await processor.apply(run, fact(2, 3, "7"))).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(released);
    expect(events).toHaveLength(eventCount);
    expect(await processor.apply(run, fact(5, 1))).toBe("committed");
    const laterRelease = await business.getContext(scope);
    expect(
      await processor.apply(run, {
        ...fact(5, 3, "7"),
        sourceCursor: "cursor-4.5-3",
        observedAt: "2026-09-24T00:00:04.500Z",
      }),
    ).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(laterRelease);
    expect(events).toHaveLength(eventCount);
  });

  it("records the first scanning stage before any lock so an older stage cannot open one", async () => {
    const { run, business, processor, events, scope } = await setup();
    expect(await processor.apply(run, fact(4, 1))).toBe("committed");
    const scanned = await business.getContext(scope);
    expect(scanned?.summary.properties).toMatchObject({
      nativeLockMissionId: "mission-1",
      nativeLockObservedAt: "2026-09-24T00:00:04Z",
    });
    expect(scanned?.actionRefs).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(await processor.apply(run, fact(2, 3, "7"))).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(scanned);
    expect(await processor.apply(run, fact(5, 3, "7"))).toBe("committed");
    expect((await business.getContext(scope))?.actionRefs).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("keeps an unqualified stage 4 as a source clock without inferring a release", async () => {
    const { run, business, processor, events, scope } = await setup();
    expect(await processor.apply(run, fact(4, 4, "7"))).toBe("committed");
    const initial = await business.getContext(scope);
    expect(initial?.summary.properties).toMatchObject({
      nativeLockObservedAt: "2026-09-24T00:00:04Z",
    });
    expect(initial?.actionRefs).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(await processor.apply(run, fact(2, 3, "7"))).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(initial);
    expect(await processor.apply(run, fact(5, 3, "7"))).toBe("committed");
    expect((await business.getContext(scope))?.actionRefs).toHaveLength(1);
    expect(events).toHaveLength(1);

    expect(await processor.apply(run, fact(6, 4, "7"))).toBe("committed");
    const stillActive = await business.getContext(scope);
    expect(stillActive?.activeRefs["visualLock:mission-1"]).toBeDefined();
    expect(events).toHaveLength(1);
    expect(
      await processor.apply(run, {
        ...fact(5, 2, "7"),
        sourceCursor: "delayed-lock-5.5",
        observedAt: "2026-09-24T00:00:05.500Z",
      }),
    ).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(stillActive);
  });

  it("uses a later targetless stage as a source clock without inventing an Action", async () => {
    const { run, business, processor, events, scope } = await setup();
    expect(await processor.apply(run, fact(4, 2))).toBe("committed");
    const targetless = await business.getContext(scope);
    expect(targetless?.actionRefs).toHaveLength(0);
    expect(targetless?.summary.properties).toMatchObject({
      nativeLockObservedAt: "2026-09-24T00:00:04Z",
    });
    expect(events).toHaveLength(0);
    expect(await processor.apply(run, fact(2, 3, "7"))).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(targetless);
  });

  it("does not order different lock stages that share one observation time", async () => {
    const { run, business, processor, events, scope } = await setup();
    expect(await processor.apply(run, fact(4, 4, "7"))).toBe("committed");
    const unqualified = await business.getContext(scope);
    expect(await processor.apply(run, fact(4, 3, "7"))).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(unqualified);
    expect(await processor.apply(run, fact(5, 3, "7"))).toBe("committed");
    const active = await business.getContext(scope);
    expect(active?.activeRefs["visualLock:mission-1"]).toBeDefined();
    expect(await processor.apply(run, fact(5, 1))).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(active);
    expect(events).toHaveLength(1);
  });

  it("advances a same-phase source clock without reopening an older phase", async () => {
    const { run, business, processor, events, scope } = await setup();
    expect(await processor.apply(run, fact(1, 2, "7"))).toBe("committed");
    expect(await processor.apply(run, fact(3, 2, "7"))).toBe("committed");
    const latest = await business.getContext(scope);
    const eventCount = events.length;
    expect(latest?.actionRefs).toHaveLength(1);
    expect(await processor.apply(run, fact(2, 3, "7"))).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(latest);
    expect(events).toHaveLength(eventCount);
  });

  it("rejects changed lock content at the same source cursor", async () => {
    const { run, business, processor, events, scope } = await setup();
    const first = fact(1, 2, "7");
    expect(await processor.apply(run, first)).toBe("committed");
    const current = await business.getContext(scope);
    await expect(
      processor.apply(run, { ...fact(2, 3, "7"), sourceCursor: first.sourceCursor }),
    ).rejects.toThrow("NATIVE_LOCK_SOURCE_CURSOR_CONFLICT");
    expect(await business.getContext(scope)).toEqual(current);
    expect(events).toHaveLength(1);
  });
});
