import { describe, expect, it, vi } from "vitest";
import { jsonToProtoStruct } from "../../packages/adapter-protocol/src/index.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import { ProviderAutoLockCoordinator } from "../../apps/ugv-provider-adapter/src/provider-auto-lock-coordinator.js";
import { TargetBusinessProcessor } from "../../apps/ugv-provider-adapter/src/target-business-processor.js";
import {
  BoundExecutionScope,
  MemoryProviderStore,
  MemoryTaskBusinessStore,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import {
  MockUgvDeviceMcpClient,
  UncertainMutatingDeviceCallError,
} from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";

async function fixture(enabled = true) {
  const store = new MemoryProviderStore();
  const business = new MemoryTaskBusinessStore();
  const device = new MockUgvDeviceMcpClient();
  const ingress = new VehicleMqttIngress("direct_domain_json", {
    maxPayloadBytes: 65_536,
    maxDepth: 16,
    maxNodes: 4096,
    maxStringBytes: 16384,
  });
  const base = Date.now();
  let offset = 0;
  const at = (delta: number) => new Date(base + delta).toISOString();
  const run: ProviderExecution = {
    taskId: "auto-lock-task",
    externalExecutionId: "auto-lock-execution",
    operationName: "vehicle_area_recon",
    argumentHash: "a".repeat(64),
    providerId: "provider-a",
    resourceId: "vehicle:ugv1",
    tracks: [],
    arguments: { resourceId: "vehicle:ugv1", scanMode: "circular" },
    executionContext: {
      authorizationContextHash: "b".repeat(64),
      executionMode: "SIMULATION",
      simulationId: "synthetic-auto-lock",
      correlationId: "test-auto-lock",
    },
    taskBusinessContextExpected: true,
    downstreamMissionIds: ["11"],
    state: "RUNNING",
    revision: 2,
    reasonCode: "UGV_RECON_RUNNING",
    createdAt: at(-1000),
    updatedAt: at(-1000),
    evidence: [],
  };
  await store.putExecution(run);
  const events: unknown[] = [];
  const service = new UgvTaskBusinessContextService(
    store,
    business,
    "provider-a",
    "vehicle:ugv1",
    (event) => {
      events.push(event);
    },
  );
  await service.ensureForCreatedExecution(run.taskId);
  const makeRuntime = () =>
    new UgvProviderRuntime(
      {
        providerId: "provider-a",
        resourceId: "vehicle:ugv1",
        freshness: { chassis: 3000, mission: 3000, health: 5000, target: 3000, payload: 3000 },
        allowNavigationWithRecon: true,
        fireEnabled: false,
        fireRequiresChassisStopped: true,
        pollIntervalMs: 60000,
        controlConfirmationTimeoutMs: 1000,
        ...(enabled ? { businessVisualLockOwner: "provider" as const } : {}),
        businessManualDecision: {
          maxWaitMs: 30000,
          onExpire: "release_and_resume_scan",
          onDismiss: "release_and_resume_scan",
        },
        now: () => new Date(base + offset),
      },
      store,
      ingress,
      device,
      new UgvBusinessEventHub(store),
      new UgvTelemetry({
        providerId: "provider-a",
        enabled: false,
        endpoint: "127.0.0.1:7002",
        tlsMode: "disabled",
      }),
      service,
    );
  let runtime = makeRuntime();
  await device.connect();
  ingress.setConnected(true, at(0));
  await runtime.initializeLocal();
  const status = async (
    stage: number,
    targetId: number,
    delta: number,
    missionId: string | null = "11",
    retained = false,
  ) => {
    offset = delta;
    ingress.handle(
      "/ugv/area_recon/status",
      Buffer.from(
        JSON.stringify({
          status: 5,
          ...(missionId ? { mission_id: missionId } : {}),
          status_label: "running",
          scan_mode: 1,
          progress: 10,
          lock: { stage, target_id: targetId, role_name: "", duration_sec: 0 },
          online: true,
        }),
      ),
      retained,
      at(delta),
    );
    await runtime.pollActive();
  };
  const targets = async (
    delta: number,
    ids = [7, 8],
    missionId: string | null = "11",
    retained = false,
  ) => {
    offset = delta;
    ingress.handle(
      "/ugv/area_recon/targets",
      Buffer.from(
        JSON.stringify({
          ...(missionId ? { mission_id: missionId } : {}),
          targets: ids.map((targetId) => ({
            target_id: targetId,
            capture_time_us: (base + delta) * 1000,
          })),
        }),
      ),
      retained,
      at(delta),
    );
    await runtime.pollActive();
  };
  const scope = BoundExecutionScope.fromExecution(run);
  const actions = async () =>
    (await business.getContextSnapshot(scope))?.objects
      .filter((object) => object.kind === "action")
      .map((object) => object.value) ?? [];
  await status(1, 0, 0);
  return {
    store,
    business,
    device,
    ingress,
    run,
    service,
    events,
    scope,
    at,
    status,
    targets,
    actions,
    runtime: () => runtime,
    advance: (delta: number) => {
      offset = delta;
    },
    restart: async () => {
      await runtime.close();
      runtime = makeRuntime();
      await device.connect();
      await runtime.initializeLocal();
      await runtime.recover();
    },
    close: () => runtime.close(),
  };
}

describe("Provider auto-lock production wire (synthetic source and device, not live qualification)", () => {
  it("selects the first visible bound target once, waits for stage 3, then requests manual input", async () => {
    const h = await fixture();
    try {
      await h.targets(100);
      expect(h.device.calls).toEqual([
        {
          name: "ugv_area_recon_lock",
          arguments: { lock: true, target_id: 7, mission_id: 11 },
          taskId: h.run.taskId,
        },
      ]);
      expect((await h.actions()).at(-1)).toMatchObject({
        state: "requested",
        triggerOrigin: "provider_policy",
        actor: { type: "provider" },
      });
      expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
      await h.targets(200);
      expect(h.device.calls).toHaveLength(1);
      await h.status(2, 7, 300);
      expect((await h.actions()).at(-1)).toMatchObject({ state: "requested" });
      expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
      await h.status(3, 7, 400);
      expect((await h.actions()).at(-1)).toMatchObject({
        state: "active",
        triggerOrigin: "provider_policy",
        startedAt: h.at(400),
        properties: { phase: "observing", triggerQualification: "journal_and_observation" },
      });
      expect(await h.service.activeRequiredInput(h.run)).toMatchObject({
        state: "pending",
        subjectBinding: { targetId: "7" },
      });
      expect((await h.store.getExecution(h.run.taskId))?.state).toBe("WAITING_INPUT");
      expect(await h.store.listActiveExecutions()).toHaveLength(1);
      await h.status(3, 7, 500);
      expect(h.device.calls).toHaveLength(1);
    } finally {
      await h.close();
    }
  });

  it.each(["continue_observation", "decline", "cancel"] as const)(
    "applies a trusted %s to the policy lock without relocking after scan resume",
    async (decision) => {
      const h = await fixture();
      try {
        await h.targets(100);
        await h.status(3, 7, 300);
        const pending = await h.service.activeRequiredInput(h.run);
        if (!pending) throw new Error("PENDING_POLICY_INPUT_MISSING");
        const identity = {
          taskId: h.run.taskId,
          externalExecutionId: h.run.externalExecutionId,
          operationName: h.run.operationName,
          argumentHash: h.run.argumentHash,
          executionContext: h.run.executionContext,
          commandSequence: "12",
        };
        const response = (actorType: "agent" | "user") => ({
          inputs: [],
          inputResponses: [
            {
              key: pending.requestKey,
              result: jsonToProtoStruct(
                decision === "continue_observation"
                  ? { action: "accept", content: { decision } }
                  : { action: decision },
              ),
              verifiedResponder: jsonToProtoStruct({
                source: "jwt_hs256",
                actorType,
                actorId: "synthetic-policy-input-user",
              }),
            },
          ],
        });
        h.advance(400);
        expect(
          await h.runtime().updateInput({ ...identity, commandSequence: "11" }, response("agent")),
        ).toMatchObject({
          accepted: false,
          reasonCode: "UGV_INPUT_RESPONDER_NOT_AUTHORIZED",
        });
        expect(h.device.calls).toHaveLength(1);
        expect((await h.store.getExecution(h.run.taskId))?.state).toBe("WAITING_INPUT");
        const ack = await h.runtime().updateInput(identity, response("user"));
        expect(ack).toMatchObject({ accepted: true });
        expect(await h.runtime().updateInput(identity, response("user"))).toMatchObject({
          accepted: true,
          reasonCode: ack.reasonCode,
        });
        expect((await h.store.getExecution(h.run.taskId))?.state).toBe("RUNNING");
        expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
        const resolvedRef = (await h.business.getContext(h.scope))?.requiredInputRefs.at(-1);
        if (!resolvedRef) throw new Error("RESOLVED_POLICY_INPUT_MISSING");
        expect(await h.business.getObjectVersion(h.scope, resolvedRef)).toMatchObject({
          kind: "input_request",
          value: {
            requestId: pending.requestId,
            state:
              decision === "continue_observation"
                ? "answered"
                : decision === "decline"
                  ? "declined"
                  : "cancelled",
          },
        });
        if (decision === "continue_observation") {
          expect(h.device.calls).toHaveLength(1);
          expect((await h.store.getExecution(h.run.taskId))?.controlConfirmation).toBeUndefined();
          expect((await h.actions()).at(-1)).toMatchObject({
            state: "active",
            triggerOrigin: "provider_policy",
          });
        } else {
          expect(h.device.calls).toHaveLength(2);
          expect(h.device.calls[1]).toMatchObject({
            name: "ugv_area_recon_lock",
            arguments: { lock: false, target_id: 0, mission_id: 11 },
          });
          expect((await h.store.getExecution(h.run.taskId))?.controlConfirmation).toMatchObject({
            command: "input_release",
            requestId: pending.requestId,
          });
        }
        await h.status(1, 0, 600);
        expect((await h.store.getExecution(h.run.taskId))?.controlConfirmation).toBeUndefined();
        expect((await h.store.getExecution(h.run.taskId))?.state).toBe("RUNNING");
        const callCount = h.device.calls.length;
        await h.targets(700);
        await h.status(1, 0, 800);
        expect(h.device.calls).toHaveLength(callCount);
        expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
        expect(await h.store.listActiveExecutions()).toHaveLength(1);
      } finally {
        await h.close();
      }
    },
  );

  it("expires the policy input and recovers one release across restart before scan confirmation", async () => {
    const h = await fixture();
    try {
      await h.targets(100);
      await h.status(3, 7, 300);
      const pending = await h.service.activeRequiredInput(h.run);
      if (!pending?.deadlineAt) throw new Error("POLICY_INPUT_DEADLINE_MISSING");
      const deadline = Date.parse(pending.deadlineAt) - Date.parse(h.at(0));
      await h.targets(deadline - 200);
      await h.status(3, 7, deadline - 100);
      h.advance(deadline);
      await h.runtime().pollActive();
      expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
      const ref = (await h.business.getContext(h.scope))?.requiredInputRefs.at(-1);
      if (!ref) throw new Error("EXPIRED_POLICY_INPUT_MISSING");
      expect(await h.business.getObjectVersion(h.scope, ref)).toMatchObject({
        kind: "input_request",
        value: { state: "expired", requestId: pending.requestId },
      });
      expect(h.device.calls).toHaveLength(2);
      expect(h.device.calls[1]).toMatchObject({
        name: "ugv_area_recon_lock",
        arguments: { lock: false, target_id: 0, mission_id: 11 },
      });
      expect((await h.store.getExecution(h.run.taskId))?.controlConfirmation).toMatchObject({
        command: "input_release",
      });
      await h.restart();
      await h.status(1, 0, deadline + 100);
      await h.targets(deadline + 200);
      expect((await h.store.getExecution(h.run.taskId))?.controlConfirmation).toBeUndefined();
      expect((await h.store.getExecution(h.run.taskId))?.state).toBe("RUNNING");
      expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
      expect(h.device.calls).toHaveLength(2);
    } finally {
      await h.close();
    }
  });

  it.each([
    "no-owner",
    "no-target-identity",
    "foreign-target-mission",
    "retained-targets",
    "no-status-identity",
    "retained-status",
    "stale-status",
  ])("does not dispatch for %s", async (scenario) => {
    const h = await fixture(scenario !== "no-owner");
    try {
      if (scenario === "no-status-identity") await h.status(1, 0, 50, null);
      if (scenario === "retained-status") await h.status(1, 0, 50, "11", true);
      await h.targets(
        scenario === "stale-status" ? 4000 : 100,
        [7],
        scenario === "no-target-identity"
          ? null
          : scenario === "foreign-target-mission"
            ? "12"
            : "11",
        scenario === "retained-targets",
      );
      expect(h.device.calls).toHaveLength(0);
      expect(await h.actions()).toHaveLength(0);
    } finally {
      await h.close();
    }
  });

  it("survives process restart without replaying an accepted lock", async () => {
    const h = await fixture();
    try {
      await h.targets(100);
      await h.restart();
      await h.targets(200);
      expect(h.device.calls).toHaveLength(1);
      await h.status(3, 7, 300);
      expect((await h.actions()).at(-1)).toMatchObject({
        state: "active",
        triggerOrigin: "provider_policy",
      });
    } finally {
      await h.close();
    }
  });

  it("retires a superseded mission request and cannot activate it with old-mission observations", async () => {
    const h = await fixture();
    try {
      await h.targets(100);
      const oldAction = (await h.actions()).at(-1);
      if (!oldAction) throw new Error("OLD_POLICY_ACTION_MISSING");
      const current = await h.store.getExecution(h.run.taskId);
      if (!current) throw new Error("CURRENT_EXECUTION_MISSING");
      await h.store.putExecution({
        ...current,
        downstreamMissionIds: ["11", "12"],
        revision: current.revision + 1,
        updatedAt: h.at(150),
      });
      await h.status(3, 7, 200, "11");
      expect(
        await h.business.getObjectVersion(h.scope, {
          kind: "action",
          id: oldAction.actionId,
          revision: 2,
        }),
      ).toMatchObject({
        value: { state: "cancelled", reasonCode: "UGV_AUTO_LOCK_MISSION_REPLACED" },
      });
      expect((await h.business.getContext(h.scope))?.activeRefs["visualLock:11"]).toBeUndefined();
      expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
      expect(h.device.calls).toHaveLength(1);

      await h.status(1, 0, 300, "12");
      await h.targets(400, [7], "12");
      const newAction = (await h.actions()).at(-1);
      expect(newAction).toMatchObject({
        state: "requested",
        properties: { observationSessionId: "12" },
      });
      expect(newAction?.actionId).not.toBe(oldAction.actionId);
      expect(h.device.calls).toHaveLength(2);
      expect(h.device.calls[1]).toMatchObject({
        name: "ugv_area_recon_lock",
        arguments: { lock: true, target_id: 7, mission_id: 12 },
      });
      const beforeStaleRun = await h.business.getContext(h.scope);
      const staleDispatch = vi.fn();
      await new ProviderAutoLockCoordinator(
        h.business,
        h.store,
        () => undefined,
        () => new Date(h.at(450)),
        1000,
      ).run({
        execution: h.run,
        candidateIds: ["7"],
        canDispatch: () => true,
        controlPending: () => false,
        dispatch: staleDispatch,
      });
      expect(staleDispatch).not.toHaveBeenCalled();
      expect(await h.business.getContext(h.scope)).toEqual(beforeStaleRun);
      await h.status(3, 7, 500, "11");
      expect((await h.actions()).at(-1)?.state).toBe("requested");
      expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
      await h.status(3, 7, 600, "12");
      expect((await h.actions()).at(-1)).toMatchObject({
        state: "active",
        properties: { observationSessionId: "12" },
      });
      expect(await h.service.activeRequiredInput(h.run)).toMatchObject({
        subjectBinding: { lockSessionId: newAction?.actionId },
      });
      expect(h.device.calls).toHaveLength(2);
    } finally {
      await h.close();
    }
  });

  it("resumes the same requested Action after a crash before dispatch intent was persisted", async () => {
    const h = await fixture();
    try {
      await new TargetBusinessProcessor(h.business, () => undefined).apply(h.run, {
        schemaVersion: "ugv.recon-target-fact/1",
        missionId: "11",
        observationSessionId: "11",
        sensorId: "ugv.area_recon.targets",
        sourceTargetId: "7",
        sourceRevision: String(Date.parse(h.at(0)) * 1000),
        observedAt: h.at(0),
        visibility: "visible",
        trackingState: "unknown",
      });
      const coordinator = new ProviderAutoLockCoordinator(
        h.business,
        h.store,
        () => undefined,
        () => new Date(h.at(0)),
        1000,
      );
      await expect(
        coordinator.run({
          execution: h.run,
          candidateIds: ["7"],
          canDispatch: () => true,
          controlPending: () => false,
          dispatch: () => Promise.reject(new Error("CRASH_BEFORE_INTENT")),
        }),
      ).rejects.toThrow("CRASH_BEFORE_INTENT");
      const initial = (await h.actions())[0];
      expect(initial).toMatchObject({ state: "requested" });
      expect(await h.store.listMutationJournal(h.run.taskId)).toEqual([]);
      await h.restart();
      await h.status(1, 0, 50);
      await h.targets(100);
      expect(h.device.calls).toHaveLength(1);
      expect(await h.actions()).toEqual([initial]);
    } finally {
      await h.close();
    }
  });

  it("does not activate from a stage 3 timestamp at the dispatch boundary", async () => {
    const h = await fixture();
    try {
      await h.targets(100);
      await h.status(3, 7, 100);
      expect((await h.actions()).at(-1)).toMatchObject({ state: "requested" });
      expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
      await h.status(3, 7, 200);
      expect((await h.actions()).at(-1)).toMatchObject({
        state: "active",
        triggerOrigin: "provider_policy",
      });
    } finally {
      await h.close();
    }
  });

  it("does not activate a policy request after its target was observed lost", async () => {
    const h = await fixture();
    try {
      await h.targets(100);
      await h.targets(200, []);
      await h.status(3, 7, 300);
      expect((await h.actions()).at(-1)).toMatchObject({ state: "requested" });
      expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it.each([true, false])(
    "rechecks source identity at dispatch while accepting newer valid scanning facts (identified=%s)",
    async (identified) => {
      const h = await fixture();
      const advance = h.store.advanceMutationJournal.bind(h.store);
      const spy = vi
        .spyOn(h.store, "advanceMutationJournal")
        .mockImplementation(async (entry, previous) => {
          if (entry.stepId.startsWith("auto-lock:") && entry.state === "DISPATCHING") {
            h.advance(150);
            h.ingress.handle(
              "/ugv/area_recon/status",
              Buffer.from(
                JSON.stringify({
                  status: 5,
                  ...(identified ? { mission_id: "11" } : {}),
                  lock: { stage: 1, target_id: 0 },
                }),
              ),
              false,
              h.at(150),
            );
          }
          return advance(entry, previous);
        });
      try {
        await h.targets(100);
        await h.runtime().pollActive();
        expect(h.device.calls).toHaveLength(identified ? 1 : 0);
        expect((await h.actions()).at(-1)).toMatchObject({
          state: identified ? "requested" : "failed",
        });
      } finally {
        spy.mockRestore();
        await h.close();
      }
    },
  );

  it("does not attribute a different target lock to the Provider policy or ask for its input", async () => {
    const h = await fixture();
    try {
      await h.targets(100);
      await h.status(3, 8, 200);
      const actions = await h.actions();
      expect(actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ state: "cancelled", triggerOrigin: "provider_policy" }),
          expect.objectContaining({ state: "active", triggerOrigin: "unknown" }),
        ]),
      );
      expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it("does not replay an uncertain dispatch and can confirm it from a later bound observation", async () => {
    const h = await fixture();
    try {
      h.device.handlers.set("ugv_area_recon_lock", () => {
        throw new UncertainMutatingDeviceCallError("UGV", "ugv_area_recon_lock");
      });
      await h.targets(100);
      expect((await h.store.listMutationJournal(h.run.taskId))[0]?.state).toBe("UNCERTAIN");
      await h.restart();
      await h.targets(200);
      expect(h.device.calls).toHaveLength(1);
      expect((await h.actions()).at(-1)).toMatchObject({ state: "requested" });
      await h.status(3, 7, 300);
      expect((await h.actions()).at(-1)).toMatchObject({
        state: "active",
        triggerOrigin: "provider_policy",
      });
    } finally {
      await h.close();
    }
  });

  it("fails a rejected or expired request without retrying another target in the mission", async () => {
    for (const rejected of [true, false]) {
      const h = await fixture();
      try {
        if (rejected) h.device.responses.set("ugv_area_recon_lock", { mission_id: 11, cmd_res: 0 });
        await h.targets(100);
        if (!rejected) {
          h.advance(1200);
          await h.runtime().pollActive();
        }
        expect((await h.actions()).at(-1)).toMatchObject({
          state: "failed",
          reasonCode: rejected ? "UGV_AUTO_LOCK_REJECTED" : "UGV_AUTO_LOCK_CONFIRMATION_TIMEOUT",
        });
        await h.targets(1500, [8]);
        expect(h.device.calls).toHaveLength(1);
        expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
      } finally {
        await h.close();
      }
    }
  });

  it.each(["pause", "cancel"] as const)(
    "lets a queued %s win at the final dispatch boundary",
    async (command) => {
      const h = await fixture();
      let control: Promise<Record<string, unknown>> | undefined;
      const advance = h.store.advanceMutationJournal.bind(h.store);
      const spy = vi
        .spyOn(h.store, "advanceMutationJournal")
        .mockImplementation(async (entry, previous) => {
          if (entry.stepId.startsWith("auto-lock:") && entry.state === "DISPATCHING") {
            control = h.runtime().command(command, {
              taskId: h.run.taskId,
              externalExecutionId: h.run.externalExecutionId,
              operationName: h.run.operationName,
              argumentHash: h.run.argumentHash,
              executionContext: h.run.executionContext,
              commandSequence: "1",
            });
          }
          return advance(entry, previous);
        });
      try {
        await h.targets(100);
        await control;
        expect(h.device.calls.filter((call) => call.name === "ugv_area_recon_lock")).toHaveLength(
          0,
        );
        expect((await h.actions()).at(-1)).toMatchObject({
          state: "cancelled",
          reasonCode: "UGV_AUTO_LOCK_CONTROL_SUPERSEDED",
        });
        expect(h.device.calls.some((call) => call.name === "ugv_area_recon_control")).toBe(true);
      } finally {
        spy.mockRestore();
        await h.close();
      }
    },
  );

  it("does not grant priority to a control for another execution identity", async () => {
    const h = await fixture();
    let control: Promise<Record<string, unknown>> | undefined;
    const advance = h.store.advanceMutationJournal.bind(h.store);
    const spy = vi
      .spyOn(h.store, "advanceMutationJournal")
      .mockImplementation(async (entry, previous) => {
        if (entry.stepId.startsWith("auto-lock:") && entry.state === "DISPATCHING") {
          control = h.runtime().command("pause", {
            taskId: h.run.taskId,
            externalExecutionId: "foreign-execution",
            operationName: h.run.operationName,
            argumentHash: h.run.argumentHash,
            executionContext: h.run.executionContext,
            commandSequence: "1",
          });
        }
        return advance(entry, previous);
      });
    try {
      await h.targets(100);
      expect(await control).toMatchObject({
        accepted: false,
        reasonCode: "TASK_IDENTITY_CONFLICT",
      });
      expect(h.device.calls).toHaveLength(1);
      expect((await h.actions()).at(-1)).toMatchObject({ state: "requested" });
    } finally {
      spy.mockRestore();
      await h.close();
    }
  });
});
