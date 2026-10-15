import { describe, expect, it, vi } from "vitest";
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
  async function deadlineRuntime() {
    const store = new MemoryProviderStore();
    const business = new MemoryTaskBusinessStore();
    const device = new MockUgvDeviceMcpClient();
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65_536,
      maxDepth: 16,
      maxNodes: 4_096,
      maxStringBytes: 16_384,
    });
    const startMs = Date.now();
    let clockMs = startMs;
    const at = (offset: number) => new Date(startMs + offset).toISOString();
    const run: ProviderExecution = {
      taskId: "task-manual-deadline",
      externalExecutionId: "execution-manual-deadline",
      operationName: "vehicle_area_recon",
      argumentHash: "d".repeat(64),
      providerId: "provider-a",
      resourceId: "vehicle:ugv1",
      tracks: [],
      arguments: { resourceId: "vehicle:ugv1", scanMode: "circular" },
      executionContext: {
        authorizationContextHash: "a".repeat(64),
        executionMode: "SIMULATION",
        simulationId: "scene-deadline-test-double",
        correlationId: "correlation-deadline",
      },
      taskBusinessContextExpected: true,
      downstreamMissionIds: ["11"],
      state: "RUNNING",
      revision: 2,
      reasonCode: "UGV_RECON_RUNNING",
      createdAt: at(-1_000),
      updatedAt: at(-1_000),
      evidence: [],
    };
    await store.putExecution(run);
    const service = new UgvTaskBusinessContextService(
      store,
      business,
      "provider-a",
      "vehicle:ugv1",
      () => undefined,
    );
    await service.ensureForCreatedExecution(run.taskId);
    const makeRuntime = () =>
      new UgvProviderRuntime(
        {
          providerId: "provider-a",
          resourceId: "vehicle:ugv1",
          freshness: {
            chassis: 3_000,
            mission: 3_000,
            health: 5_000,
            target: 3_000,
            payload: 3_000,
          },
          allowNavigationWithRecon: true,
          fireRequiresChassisStopped: true,
          pollIntervalMs: 60_000,
          controlConfirmationTimeoutMs: 2_000,
          businessManualDecision: {
            maxWaitMs: 1_000,
            onExpire: "release_and_resume_scan",
            onDismiss: "release_and_resume_scan",
          },
          now: () => new Date(clockMs),
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
    const runtime = makeRuntime();
    await runtime.initializeLocal();
    const status = (stage: number, targetId: number, observedAt: string) =>
      ingress.handle(
        "/ugv/area_recon/status",
        Buffer.from(
          JSON.stringify({
            status: 5,
            mission_id: "11",
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
    status(3, 7, at(0));
    await runtime.pollActive();
    expect((await store.getExecution(run.taskId))?.state).toBe("WAITING_INPUT");
    const pending = await service.activeRequiredInput(run);
    if (!pending) throw new Error("PENDING_REQUEST_MISSING");
    return {
      store,
      business,
      device,
      service,
      runtime,
      makeRuntime,
      run,
      pending,
      at,
      status,
      advance: (offset: number) => {
        clockMs = startMs + offset;
      },
    };
  }

  async function answer(
    h: Awaited<ReturnType<typeof deadlineRuntime>>,
    action: "decline" | "cancel",
    commandSequence: string,
    development = false,
  ) {
    return h.runtime.updateInput(
      {
        taskId: h.run.taskId,
        externalExecutionId: h.run.externalExecutionId,
        operationName: h.run.operationName,
        argumentHash: h.run.argumentHash,
        executionContext: h.run.executionContext,
        commandSequence,
      },
      {
        inputs: [],
        inputResponses: [
          {
            key: h.pending.requestKey,
            result: jsonToProtoStruct({ action }),
            verifiedResponder: jsonToProtoStruct(
              development
                ? {
                    source: "development",
                    actorType: "development_anonymous",
                    actorId: "development-anonymous",
                  }
                : { source: "jwt_hs256", actorType: "user", actorId: "test-user" },
            ),
          },
        ],
      },
    );
  }

  for (const action of ["decline", "cancel"] as const) {
    it(`routes a verified ${action} to one unlock without cancelling the Task`, async () => {
      const h = await deadlineRuntime();
      try {
        const reasonCode =
          action === "cancel" ? "TARGET_OBSERVATION_DISMISSED" : "TARGET_OBSERVATION_DECLINED";
        expect(await answer(h, action, "12")).toMatchObject({ accepted: true, reasonCode });
        expect((await h.store.getExecution(h.run.taskId))?.state).toBe("RUNNING");
        expect((await h.store.getExecution(h.run.taskId))?.controlConfirmation).toMatchObject({
          command: "input_release",
          requestId: h.pending.requestId,
        });
        const context = await h.business.getContext(BoundExecutionScope.fromExecution(h.run));
        const ref = context?.requiredInputRefs.at(-1);
        if (!ref) throw new Error("RESOLVED_INPUT_MISSING");
        expect(
          await h.business.getObjectVersion(BoundExecutionScope.fromExecution(h.run), ref),
        ).toMatchObject({ value: { state: action === "cancel" ? "cancelled" : "declined" } });
        expect(h.device.calls).toEqual([
          {
            name: "ugv_area_recon_lock",
            arguments: { lock: false, target_id: 0, mission_id: 11 },
            taskId: h.run.taskId,
          },
        ]);
        expect(await answer(h, action, "12")).toMatchObject({ accepted: true, reasonCode });
        expect(h.device.calls).toHaveLength(1);
        h.advance(1);
        h.status(1, 0, h.at(1));
        await h.runtime.pollActive();
        expect((await h.store.getExecution(h.run.taskId))?.controlConfirmation).toBeUndefined();
        await h.runtime.pollActive();
        expect((await h.store.getExecution(h.run.taskId))?.controlConfirmation).toBeUndefined();
        expect(h.device.calls).toHaveLength(1);
      } finally {
        await h.runtime.close();
      }
    });
  }

  it("keeps the prompt pending and records a refused decline when unlock is rejected", async () => {
    const h = await deadlineRuntime();
    try {
      h.device.responses.set("ugv_area_recon_lock", {
        mission_id: 11,
        cmd_res: 0,
        fail_data: "release refused",
      });
      expect(await answer(h, "decline", "12")).toMatchObject({ accepted: false });
      expect((await h.store.getExecution(h.run.taskId))?.state).toBe("WAITING_INPUT");
      expect(await h.service.activeRequiredInput(h.run)).toMatchObject({ state: "pending" });
      const claim = await h.business.getAcceptedInputCommand(
        BoundExecutionScope.fromExecution(h.run),
        h.pending.requestKey,
      );
      expect(claim).toBeUndefined();
      expect(h.device.calls).toHaveLength(1);
      expect(await answer(h, "decline", "12")).toMatchObject({ accepted: false });
      expect(h.device.calls).toHaveLength(1);
    } finally {
      await h.runtime.close();
    }
  });

  it("retries a storage failure before unlock without rejecting the claimed decision", async () => {
    const h = await deadlineRuntime();
    try {
      const read = vi
        .spyOn(h.store, "getMutationJournalEntry")
        .mockRejectedValueOnce(new Error("TRANSIENT_JOURNAL_READ_FAILURE"));
      await expect(answer(h, "decline", "12")).rejects.toThrow("TRANSIENT_JOURNAL_READ_FAILURE");
      expect(h.device.calls).toHaveLength(0);
      expect(
        await h.business.getAcceptedInputCommand(
          BoundExecutionScope.fromExecution(h.run),
          h.pending.requestKey,
        ),
      ).toMatchObject({ state: "accepted", inputResponse: { action: "decline" } });
      read.mockRestore();
      expect(await answer(h, "decline", "12")).toMatchObject({
        accepted: true,
        reasonCode: "TARGET_OBSERVATION_DECLINED",
      });
      expect(h.device.calls).toHaveLength(1);
    } finally {
      await h.runtime.close();
    }
  });

  it.each([
    { development: false, legacy: false },
    { development: true, legacy: false },
    { development: false, legacy: true },
  ])(
    "recovers a claimed decline without a second unlock (development=$development, legacy=$legacy)",
    async ({ development, legacy }) => {
      const h = await deadlineRuntime();
      let restarted: UgvProviderRuntime | undefined;
      try {
        const originalClaim = h.business.claimCommand.bind(h.business);
        const legacyClaim = legacy
          ? vi
              .spyOn(h.business, "claimCommand")
              .mockImplementation((scope, candidate, ref, now, revision, options) => {
                const admitted = { ...candidate };
                delete admitted.responder;
                return originalClaim(scope, admitted, ref, now, revision, options);
              })
          : undefined;
        const originalCommit = h.business.commitBusinessChangeSet.bind(h.business);
        const commit = vi
          .spyOn(h.business, "commitBusinessChangeSet")
          .mockImplementation((changeSet, events) => {
            if (
              changeSet.objects.some(
                (item) => item.kind === "input_request" && item.value.state === "declined",
              )
            )
              return Promise.reject(new Error("TRANSIENT_BUSINESS_STORE_FAILURE"));
            return originalCommit(changeSet, events);
          });
        await expect(answer(h, "decline", "12", development)).rejects.toThrow(
          "TRANSIENT_BUSINESS_STORE_FAILURE",
        );
        const accepted = await h.business.getAcceptedInputCommand(
          BoundExecutionScope.fromExecution(h.run),
          h.pending.requestKey,
        );
        expect(accepted).toMatchObject({
          state: "accepted",
          inputResponse: { action: "decline" },
        });
        expect(accepted?.responder).toEqual(
          legacy
            ? undefined
            : development
              ? {
                  source: "runtime_development_policy",
                  actorType: "development_anonymous",
                  verified: false,
                }
              : { source: "runtime_authorization_context", actorType: "user", verified: true },
        );
        expect(h.device.calls).toHaveLength(1);
        await h.runtime.close();
        commit.mockRestore();
        legacyClaim?.mockRestore();
        h.advance(legacy ? 500 : 1_000);
        restarted = h.makeRuntime();
        await restarted.initializeLocal();
        await restarted.pollActive();
        expect(h.device.calls).toHaveLength(1);
        if (legacy) {
          // Old admitted records have no auditable responder. Recovery waits for
          // Runtime to replay its original envelope instead of inventing an identity.
          expect((await h.store.getExecution(h.run.taskId))?.state).toBe("WAITING_INPUT");
          expect(await answer({ ...h, runtime: restarted }, "decline", "12")).toMatchObject({
            accepted: true,
          });
          expect(h.device.calls).toHaveLength(1);
        }
        expect(await h.store.getExecution(h.run.taskId)).toMatchObject({
          state: "RUNNING",
          reasonCode: "UGV_INPUT_RELEASE_ACCEPTED_AWAITING_OBSERVATION",
        });
        const context = await h.business.getContext(BoundExecutionScope.fromExecution(h.run));
        const ref = context?.requiredInputRefs.at(-1);
        if (!ref) throw new Error("RESOLVED_INPUT_MISSING");
        expect(
          await h.business.getObjectVersion(BoundExecutionScope.fromExecution(h.run), ref),
        ).toMatchObject({ value: { state: "declined" } });
        h.advance(1_001);
        h.status(1, 0, h.at(1_001));
        await restarted.pollActive();
        expect((await h.store.getExecution(h.run.taskId))?.controlConfirmation).toBeUndefined();
      } finally {
        await restarted?.close();
        await h.runtime.close();
      }
    },
  );

  it("rebuilds release confirmation after the reply committed but Execution persistence failed", async () => {
    const h = await deadlineRuntime();
    let restarted: UgvProviderRuntime | undefined;
    try {
      const originalPut = h.store.putExecution.bind(h.store);
      const put = vi
        .spyOn(h.store, "putExecution")
        .mockImplementation((value) =>
          value.reasonCode === "UGV_INPUT_RELEASE_ACCEPTED_AWAITING_OBSERVATION"
            ? Promise.reject(new Error("TRANSIENT_EXECUTION_STORE_FAILURE"))
            : originalPut(value),
        );
      await expect(answer(h, "decline", "12")).rejects.toThrow("TRANSIENT_EXECUTION_STORE_FAILURE");
      expect((await h.store.getExecution(h.run.taskId))?.state).toBe("WAITING_INPUT");
      expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
      expect(h.device.calls).toHaveLength(1);
      await h.runtime.close();
      put.mockRestore();
      h.advance(1);
      h.status(1, 0, h.at(1));
      restarted = h.makeRuntime();
      await restarted.initializeLocal();
      await restarted.pollActive();
      expect(await h.store.getExecution(h.run.taskId)).toMatchObject({
        state: "RUNNING",
        reasonCode: "UGV_INPUT_RELEASE_ACCEPTED_AWAITING_OBSERVATION",
        controlConfirmation: { command: "input_release" },
      });
      // A recreated Runtime must receive a new packet; the sticky ingress snapshot is not provenance.
      h.advance(2);
      h.status(1, 0, h.at(2));
      await restarted.pollActive();
      expect((await h.store.getExecution(h.run.taskId))?.controlConfirmation).toBeUndefined();
      expect(h.device.calls).toHaveLength(1);
    } finally {
      await restarted?.close();
      await h.runtime.close();
    }
  });

  it("expires a bound decision, journals one release, and waits for post-command scan evidence", async () => {
    const h = await deadlineRuntime();
    try {
      h.advance(1_000);
      await h.runtime.pollActive();
      const released = await h.store.getExecution(h.run.taskId);
      expect(released).toMatchObject({
        state: "RUNNING",
        reasonCode: "UGV_INPUT_RELEASE_ACCEPTED_AWAITING_OBSERVATION",
        controlConfirmation: { command: "input_release", requestId: h.pending.requestId },
      });
      expect(await h.service.activeRequiredInput(h.run)).toBeUndefined();
      const snapshot = await h.business.getContextSnapshot(
        BoundExecutionScope.fromExecution(h.run),
      );
      expect(
        snapshot?.objects.find(
          (item) =>
            item.kind === "input_request" &&
            item.value.requestId === h.pending.requestId &&
            item.value.revision === 2,
        ),
      ).toMatchObject({ value: { state: "expired" } });
      expect(h.device.calls).toEqual([
        {
          name: "ugv_area_recon_lock",
          arguments: { lock: false, target_id: 0, mission_id: 11 },
          taskId: h.run.taskId,
        },
      ]);
      await h.runtime.pollActive();
      expect(h.device.calls).toHaveLength(1);
      expect((await h.store.getExecution(h.run.taskId))?.reasonCode).toBe(
        "UGV_INPUT_RELEASE_ACCEPTED_AWAITING_OBSERVATION",
      );
      h.advance(1_001);
      h.status(1, 0, h.at(1_001));
      await h.runtime.pollActive();
      expect(await h.store.getExecution(h.run.taskId)).toMatchObject({ state: "RUNNING" });
      expect((await h.store.getExecution(h.run.taskId))?.controlConfirmation).toBeUndefined();
      expect(
        (await h.business.getContext(BoundExecutionScope.fromExecution(h.run)))?.activeRefs[
          "visualLock:11"
        ],
      ).toBeUndefined();
      expect(h.device.calls).toHaveLength(1);
    } finally {
      await h.runtime.close();
    }
  });

  it("expires without dispatch when the lock source is stale and reports unconfirmed release", async () => {
    const h = await deadlineRuntime();
    try {
      h.advance(4_000);
      await h.runtime.pollActive();
      expect(h.device.calls).toHaveLength(0);
      expect(await h.store.getExecution(h.run.taskId)).toMatchObject({
        state: "TECHNICAL_FAILED",
        reasonCode: "UGV_INPUT_EXPIRY_RELEASE_UNQUALIFIED",
      });
      const snapshot = await h.business.getContextSnapshot(
        BoundExecutionScope.fromExecution(h.run),
      );
      expect(snapshot?.context.summary.status).toBe("finalized");
      expect(
        snapshot?.objects.find(
          (item) =>
            item.kind === "input_request" &&
            item.value.requestId === h.pending.requestId &&
            item.value.revision === 2,
        ),
      ).toMatchObject({ value: { state: "expired" } });
    } finally {
      await h.runtime.close();
    }
  });

  it("fails explicitly if an accepted release never produces post-command scanning evidence", async () => {
    const h = await deadlineRuntime();
    try {
      h.advance(1_000);
      await h.runtime.pollActive();
      expect((await h.store.getExecution(h.run.taskId))?.state).toBe("RUNNING");
      h.advance(3_001);
      await h.runtime.pollActive();
      expect(await h.store.getExecution(h.run.taskId)).toMatchObject({
        state: "TECHNICAL_FAILED",
        reasonCode: "UGV_INPUT_RELEASE_CONFIRMATION_TIMEOUT",
      });
      expect(h.device.calls).toHaveLength(1);
      expect(
        (await h.business.getContext(BoundExecutionScope.fromExecution(h.run)))?.summary.status,
      ).toBe("finalized");
    } finally {
      await h.runtime.close();
    }
  });

  it("records expiry and fails without claiming release when the device rejects unlock", async () => {
    const h = await deadlineRuntime();
    try {
      h.device.responses.set("ugv_area_recon_lock", {
        mission_id: 11,
        cmd_res: 0,
        fail_data: "lock release rejected",
      });
      h.advance(1_000);
      await h.runtime.pollActive();
      expect(await h.store.getExecution(h.run.taskId)).toMatchObject({
        state: "TECHNICAL_FAILED",
        reasonCode: "UGV_INPUT_EXPIRY_RELEASE_REJECTED",
      });
      expect(h.device.calls).toHaveLength(1);
      const snapshot = await h.business.getContextSnapshot(
        BoundExecutionScope.fromExecution(h.run),
      );
      expect(
        snapshot?.objects.find(
          (item) =>
            item.kind === "input_request" &&
            item.value.requestId === h.pending.requestId &&
            item.value.revision === 2,
        ),
      ).toMatchObject({ value: { state: "expired" } });
    } finally {
      await h.runtime.close();
    }
  });

  it("does not send a release after a new source fact already ended the lock", async () => {
    const h = await deadlineRuntime();
    try {
      h.advance(1_000);
      h.status(1, 0, h.at(1_000));
      await h.runtime.pollActive();
      expect(h.device.calls).toHaveLength(0);
      expect((await h.store.getExecution(h.run.taskId))?.state).toBe("RUNNING");
      const snapshot = await h.business.getContextSnapshot(
        BoundExecutionScope.fromExecution(h.run),
      );
      expect(
        snapshot?.objects.find(
          (item) =>
            item.kind === "input_request" &&
            item.value.requestId === h.pending.requestId &&
            item.value.revision === 2,
        ),
      ).toMatchObject({ value: { state: "cancelled" } });
    } finally {
      await h.runtime.close();
    }
  });

  it("replays an accepted release journal after the business commit fails", async () => {
    const h = await deadlineRuntime();
    try {
      const originalCommit = h.business.commitBusinessChangeSet.bind(h.business);
      let blockExpiredCommit = true;
      let failedCommits = 0;
      const commit = vi
        .spyOn(h.business, "commitBusinessChangeSet")
        .mockImplementation((changeSet, events) => {
          if (
            blockExpiredCommit &&
            changeSet.objects.some(
              (item) => item.kind === "input_request" && item.value.state === "expired",
            )
          ) {
            failedCommits += 1;
            return Promise.reject(new Error("TRANSIENT_BUSINESS_STORE_FAILURE"));
          }
          return originalCommit(changeSet, events);
        });
      h.advance(1_000);
      await h.runtime.pollActive().catch(() => undefined);
      expect(failedCommits).toBeGreaterThan(0);
      expect(h.device.calls).toHaveLength(1);
      expect((await h.store.getExecution(h.run.taskId))?.state).toBe("WAITING_INPUT");
      blockExpiredCommit = false;
      commit.mockRestore();
      await h.runtime.pollActive();
      expect(h.device.calls).toHaveLength(1);
      expect(await h.store.getExecution(h.run.taskId)).toMatchObject({
        state: "RUNNING",
        reasonCode: "UGV_INPUT_RELEASE_ACCEPTED_AWAITING_OBSERVATION",
      });
    } finally {
      await h.runtime.close();
    }
  });

  it("keeps deadline expiry across restart when stage 1 arrives after an accepted unlock", async () => {
    const h = await deadlineRuntime();
    let restarted: UgvProviderRuntime | undefined;
    try {
      const originalCommit = h.business.commitBusinessChangeSet.bind(h.business);
      const commit = vi
        .spyOn(h.business, "commitBusinessChangeSet")
        .mockImplementation((changeSet, events) => {
          if (
            changeSet.objects.some(
              (item) => item.kind === "input_request" && item.value.state === "expired",
            )
          )
            return Promise.reject(new Error("TRANSIENT_BUSINESS_STORE_FAILURE"));
          return originalCommit(changeSet, events);
        });
      h.advance(1_000);
      await h.runtime.pollActive().catch(() => undefined);
      expect(h.device.calls).toHaveLength(1);
      expect((await h.store.getExecution(h.run.taskId))?.state).toBe("WAITING_INPUT");
      await h.runtime.close();
      commit.mockRestore();
      h.advance(1_001);
      h.status(1, 0, h.at(1_001));
      restarted = h.makeRuntime();
      await restarted.initializeLocal();
      await restarted.pollActive();
      expect(h.device.calls).toHaveLength(1);
      expect(await h.store.getExecution(h.run.taskId)).toMatchObject({
        state: "RUNNING",
        reasonCode: "UGV_INPUT_RELEASE_ACCEPTED_AWAITING_OBSERVATION",
      });
      const snapshot = await h.business.getContextSnapshot(
        BoundExecutionScope.fromExecution(h.run),
      );
      expect(
        snapshot?.objects.find(
          (item) =>
            item.kind === "input_request" &&
            item.value.requestId === h.pending.requestId &&
            item.value.revision === 2,
        ),
      ).toMatchObject({ value: { state: "expired" } });
      h.status(1, 0, h.at(1_002));
      h.advance(1_002);
      await restarted.pollActive();
      expect((await h.store.getExecution(h.run.taskId))?.controlConfirmation).toBeUndefined();
    } finally {
      await restarted?.close();
      await h.runtime.close();
    }
  });

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
      ).toHaveLength(1);
      expect(
        (await business.getContext(BoundExecutionScope.fromExecution(run)))?.summary.properties,
      ).toMatchObject({ reconTargetCorrelation: "INFERRED_CURRENT_EXECUTION" });
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
      ).toHaveLength(2);
      const targetVersions = (
        await business.getContextSnapshot(BoundExecutionScope.fromExecution(run))
      )?.objects.filter(
        (item) => item.kind === "artifact" && item.value.artifactType === "target.object",
      );
      expect(
        new Set(
          targetVersions?.map((item) => (item.kind === "artifact" ? item.value.artifactId : "")),
        ).size,
      ).toBe(1);
      expect(
        (await business.getContext(BoundExecutionScope.fromExecution(run)))?.summary.properties,
      ).toMatchObject({ reconTargetCorrelation: "STRICT_CORRELATED" });

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
