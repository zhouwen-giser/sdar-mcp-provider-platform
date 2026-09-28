import { describe, expect, it } from "vitest";
import { jsonToProtoStruct } from "../../packages/adapter-protocol/src/index.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import {
  BoundExecutionScope,
  MemoryProviderStore,
  MemoryTaskBusinessStore,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";

describe("UGV manual observation input production wire", () => {
  it("routes an MQTT lock through WAITING_INPUT and an authorized UpdateExecution response", async () => {
    const store = new MemoryProviderStore();
    const business = new MemoryTaskBusinessStore();
    const device = new MockUgvDeviceMcpClient();
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65_536,
      maxDepth: 16,
      maxNodes: 4_096,
      maxStringBytes: 16_384,
    });
    const nowMs = Date.now();
    const at = (offset: number) => new Date(nowMs + offset).toISOString();
    const run: ProviderExecution = {
      taskId: "task-manual-wire",
      externalExecutionId: "execution-manual-wire",
      operationName: "vehicle_area_recon",
      argumentHash: "b".repeat(64),
      providerId: "provider-a",
      resourceId: "vehicle:ugv1",
      tracks: [],
      arguments: { resourceId: "vehicle:ugv1", scanMode: "circular" },
      executionContext: {
        authorizationContextHash: "a".repeat(64),
        executionMode: "SIMULATION",
        simulationId: "scene-test-double",
        correlationId: "correlation-a",
      },
      taskBusinessContextExpected: true,
      downstreamMissionIds: ["1"],
      state: "RUNNING",
      revision: 2,
      reasonCode: "UGV_RECON_RUNNING",
      createdAt: at(-1_000),
      updatedAt: at(-1_000),
      evidence: [],
    };
    await store.putExecution(run);
    const events = new UgvBusinessEventHub(store);
    const service = new UgvTaskBusinessContextService(
      store,
      business,
      "provider-a",
      "vehicle:ugv1",
      () => undefined,
    );
    await service.ensureForCreatedExecution(run.taskId);
    const runtime = new UgvProviderRuntime(
      {
        providerId: "provider-a",
        resourceId: "vehicle:ugv1",
        freshness: { chassis: 3_000, mission: 3_000, health: 5_000, target: 3_000, payload: 3_000 },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        pollIntervalMs: 60_000,
        businessManualDecision: {
          maxWaitMs: 30_000,
          onExpire: "release_and_resume_scan",
          onDismiss: "release_and_resume_scan",
        },
      },
      store,
      ingress,
      device,
      events,
      new UgvTelemetry({
        providerId: "provider-a",
        enabled: false,
        endpoint: "127.0.0.1:7002",
        tlsMode: "disabled",
      }),
      service,
    );
    await runtime.initializeLocal();
    try {
      const status = (stage: number, targetId: number, observedAt: string) => {
        ingress.handle(
          "/ugv/area_recon/status",
          Buffer.from(
            JSON.stringify({
              status: 5,
              mission_id: "1",
              status_label: "running",
              scan_mode: 1,
              progress: 10,
              coverage: 10,
              lock: { stage, target_id: targetId, role_name: "", duration_sec: 0 },
              online: true,
            }),
          ),
          false,
          observedAt,
        );
      };
      status(3, 7, at(0));
      await runtime.pollActive();
      const waiting = await store.getExecution(run.taskId);
      expect(waiting?.state).toBe("WAITING_INPUT");
      if (!waiting) throw new Error("EXECUTION_MISSING");
      expect(await service.activeRequiredInput(waiting)).toMatchObject({
        inputType: "target.disposition_decision",
        state: "pending",
        subjectBinding: { targetId: "7" },
      });
      expect(device.calls).toHaveLength(0);

      ingress.handle(
        "/ugv/area_recon/targets",
        Buffer.from(
          JSON.stringify({ targets: [{ target_id: 7, capture_time_us: (nowMs + 1) * 1_000 }] }),
        ),
        false,
        at(1),
      );
      await runtime.pollActive();
      expect(
        (await business.getContextSnapshot(BoundExecutionScope.fromExecution(run)))?.objects.filter(
          (item) => item.kind === "artifact" && item.value.artifactType === "target.object",
        ),
      ).toEqual([]);
      ingress.handle(
        "/ugv/area_recon/targets",
        Buffer.from(
          JSON.stringify({
            mission_id: 1,
            targets: [{ target_id: 7, capture_time_us: (nowMs + 2) * 1_000 }],
          }),
        ),
        false,
        at(2),
      );
      await runtime.pollActive();
      expect(
        (await business.getContextSnapshot(BoundExecutionScope.fromExecution(run)))?.objects.filter(
          (item) => item.kind === "artifact" && item.value.artifactType === "target.object",
        ),
      ).toHaveLength(1);

      // Simulate a restart gap after the Context was committed but before the
      // Execution state was persisted; polling must restore the visible wait.
      await store.putExecution({ ...waiting, state: "RUNNING", revision: waiting.revision + 1 });
      await runtime.pollActive();
      expect((await store.getExecution(run.taskId))?.state).toBe("WAITING_INPUT");

      const pending = await service.activeRequiredInput(waiting);
      if (!pending) throw new Error("PENDING_REQUEST_MISSING");
      const identity = (commandSequence: string) => ({
        taskId: run.taskId,
        externalExecutionId: run.externalExecutionId,
        operationName: run.operationName,
        argumentHash: run.argumentHash,
        executionContext: run.executionContext,
        commandSequence,
      });
      const response = (decision: string, actorType: string) => ({
        inputs: [],
        inputResponses: [
          {
            key: pending.requestKey,
            result: jsonToProtoStruct({ action: "accept", content: { decision } }),
            verifiedResponder: jsonToProtoStruct({
              source: "jwt_hs256",
              actorType,
              actorId: "test-user",
            }),
          },
        ],
      });
      expect(
        await runtime.updateInput(identity("8"), {
          inputs: [],
          inputResponses: [
            {
              key: pending.requestKey,
              result: jsonToProtoStruct({ action: "decline" }),
              verifiedResponder: jsonToProtoStruct({
                source: "jwt_hs256",
                actorType: "user",
                actorId: "test-user",
              }),
            },
          ],
        }),
      ).toMatchObject({ accepted: false, reasonCode: "UGV_INPUT_RELEASE_NOT_QUALIFIED" });
      expect(
        await runtime.updateInput(identity("9"), response("continue_observation", "agent")),
      ).toMatchObject({
        accepted: false,
        reasonCode: "UGV_INPUT_RESPONDER_NOT_AUTHORIZED",
      });
      expect(await runtime.updateInput(identity("10"), response("unknown", "user"))).toMatchObject({
        accepted: false,
      });
      expect((await service.activeRequiredInput(waiting))?.requestId).toBe(pending.requestId);
      const ack = await runtime.updateInput(
        identity("11"),
        response("continue_observation", "user"),
      );
      expect(ack).toMatchObject({ accepted: true, reasonCode: "TARGET_OBSERVATION_CONTINUES" });
      expect(
        await runtime.updateInput(identity("11"), response("continue_observation", "user")),
      ).toMatchObject({
        accepted: true,
        reasonCode: "TARGET_OBSERVATION_CONTINUES",
      });
      expect((await store.getExecution(run.taskId))?.state).toBe("RUNNING");
      expect(await service.activeRequiredInput(waiting)).toBeUndefined();
      expect(device.calls).toHaveLength(0);

      status(1, 0, at(1));
      await runtime.pollActive();
      const released = await store.getExecution(run.taskId);
      expect(released?.state).toBe("RUNNING");
      if (!released) throw new Error("EXECUTION_MISSING");
      expect(await service.activeRequiredInput(released)).toBeUndefined();
      expect(device.calls).toHaveLength(0);
    } finally {
      await runtime.close();
    }
  });

  it("keeps auto observation running without a RequiredInput or duplicate lock command", async () => {
    const store = new MemoryProviderStore();
    const business = new MemoryTaskBusinessStore();
    const device = new MockUgvDeviceMcpClient();
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65_536,
      maxDepth: 16,
      maxNodes: 4_096,
      maxStringBytes: 16_384,
    });
    const nowMs = Date.now();
    const at = (offset: number) => new Date(nowMs + offset).toISOString();
    const run: ProviderExecution = {
      taskId: "task-auto-wire",
      externalExecutionId: "execution-auto-wire",
      operationName: "vehicle_area_recon",
      argumentHash: "c".repeat(64),
      providerId: "provider-a",
      resourceId: "vehicle:ugv1",
      tracks: [],
      arguments: { resourceId: "vehicle:ugv1", scanMode: "circular" },
      executionContext: {
        authorizationContextHash: "a".repeat(64),
        executionMode: "SIMULATION",
        simulationId: "scene-auto-test-double",
        correlationId: "correlation-auto",
      },
      taskBusinessContextExpected: true,
      downstreamMissionIds: ["2"],
      state: "RUNNING",
      revision: 2,
      reasonCode: "UGV_RECON_RUNNING",
      createdAt: at(-1_000),
      updatedAt: at(-1_000),
      evidence: [],
    };
    await store.putExecution(run);
    const events = new UgvBusinessEventHub(store);
    const service = new UgvTaskBusinessContextService(
      store,
      business,
      "provider-a",
      "vehicle:ugv1",
      () => undefined,
    );
    await service.ensureForCreatedExecution(run.taskId);
    const runtime = new UgvProviderRuntime(
      {
        providerId: "provider-a",
        resourceId: "vehicle:ugv1",
        freshness: { chassis: 3_000, mission: 3_000, health: 5_000, target: 3_000, payload: 3_000 },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        pollIntervalMs: 60_000,
      },
      store,
      ingress,
      device,
      events,
      new UgvTelemetry({
        providerId: "provider-a",
        enabled: false,
        endpoint: "127.0.0.1:7002",
        tlsMode: "disabled",
      }),
      service,
    );
    await runtime.initializeLocal();
    try {
      const status = (stage: number, targetId: number, observedAt: string) => {
        ingress.handle(
          "/ugv/area_recon/status",
          Buffer.from(
            JSON.stringify({
              status: 5,
              mission_id: "2",
              status_label: "running",
              scan_mode: 1,
              progress: 10,
              coverage: 10,
              lock: { stage, target_id: targetId, role_name: "", duration_sec: 0 },
              online: true,
            }),
          ),
          false,
          observedAt,
        );
      };
      status(3, 7, at(0));
      await runtime.pollActive();
      const active = await business.getContext(BoundExecutionScope.fromExecution(run));
      expect((await store.getExecution(run.taskId))?.state).toBe("RUNNING");
      expect(await service.activeRequiredInput(run)).toBeUndefined();
      expect(active?.activeRefs["visualLock:2"]).toMatchObject({ kind: "action", revision: 1 });
      const activeRef = active?.activeRefs["visualLock:2"];
      if (!activeRef) throw new Error("LOCK_ACTION_MISSING");
      expect(
        await business.getObjectVersion(BoundExecutionScope.fromExecution(run), activeRef),
      ).toMatchObject({ value: { triggerOrigin: "unknown", state: "active" } });
      expect(device.calls).toHaveLength(0);

      status(1, 0, at(1));
      await runtime.pollActive();
      const released = await business.getContext(BoundExecutionScope.fromExecution(run));
      expect((await store.getExecution(run.taskId))?.state).toBe("RUNNING");
      expect(released?.activeRefs["visualLock:2"]).toBeUndefined();
      expect(released?.phase?.code).toBe("recon.scanning");
      const terminalRef = released?.actionRefs.at(-1);
      if (!terminalRef) throw new Error("TERMINAL_LOCK_ACTION_MISSING");
      expect(
        await business.getObjectVersion(BoundExecutionScope.fromExecution(run), terminalRef),
      ).toMatchObject({
        value: { state: "completed", endReason: "VISUAL_LOCK_END_CAUSE_UNKNOWN" },
      });
      expect(await service.activeRequiredInput(run)).toBeUndefined();
      expect(device.calls).toHaveLength(0);
    } finally {
      await runtime.close();
    }
  });
});
