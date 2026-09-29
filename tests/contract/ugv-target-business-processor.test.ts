import { describe, expect, it, vi } from "vitest";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { TargetBusinessProcessor } from "../../apps/ugv-provider-adapter/src/target-business-processor.js";
import {
  UGV_RECON_BUSINESS_PROFILE,
  UgvTaskBusinessContextService,
} from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import {
  BoundExecutionScope,
  MemoryProviderStore,
  MemoryTaskBusinessStore,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";

const at = "2026-09-24T00:00:00Z";
const captureTimeUs = Date.parse("2026-09-24T00:00:02Z") * 1000;

function execution(): ProviderExecution {
  return {
    taskId: "task-targets",
    externalExecutionId: "execution-targets",
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

function targetFact(sourceTargetId: string) {
  return {
    schemaVersion: "ugv.recon-target-fact/1",
    missionId: "mission-1",
    observationSessionId: "mission-1",
    sensorId: "ugv.area_recon.targets",
    sourceTargetId,
    sourceRevision: String(captureTimeUs),
    observedAt: "2026-09-24T00:00:02Z",
    visibility: "visible",
    trackingState: "unknown",
    location: { longitude: 116, latitude: 39 },
    pixel: { x: 10, y: 20, width: 30, height: 40 },
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
  const processor = new TargetBusinessProcessor(business, (event) => events.push(event));
  return {
    run,
    executions,
    business,
    service,
    events,
    processor,
    scope: BoundExecutionScope.fromExecution(run),
  };
}

describe("UGV target business projection", () => {
  it("rejects historical mission and pre-execution target captures before publishing", async () => {
    const { run, business, processor, events, scope } = await setup();
    const replacement = { ...run, downstreamMissionIds: ["mission-1", "mission-2"] };
    const current = {
      ...targetFact("7"),
      missionId: "mission-2",
      observationSessionId: "mission-2",
    };
    const before = await business.getContext(scope);
    await expect(processor.apply(replacement, targetFact("7"))).rejects.toThrow(
      "TARGET_EXECUTION_SESSION_BINDING_INVALID",
    );
    await expect(
      processor.apply(replacement, { ...current, observedAt: "2026-09-23T23:59:59Z" }),
    ).rejects.toThrow("TARGET_EXECUTION_SESSION_BINDING_INVALID");
    expect(await business.getContext(scope)).toEqual(before);
    expect(events).toHaveLength(0);
    expect(await processor.apply(replacement, current)).toBe("committed");
  });

  it("advertises observed target objects and tracks for recon reads", () => {
    expect(UGV_RECON_BUSINESS_PROFILE.artifactTypes).toContain("target.object");
    expect(UGV_RECON_BUSINESS_PROFILE.artifactTypes).toContain("target.track");
  });
  it("keeps every discovered target, a stable ID, history, and map/image representations", async () => {
    const { run, business, processor, events, scope } = await setup();
    expect(await processor.apply(run, targetFact("1"))).toBe("committed");
    expect(await processor.apply(run, targetFact("1"))).toBe("duplicate");
    expect(
      await processor.apply(run, {
        ...targetFact("2"),
        location: undefined,
        pixel: { x: 50, y: 60, width: 10, height: 12 },
      }),
    ).toBe("committed");
    expect(
      await processor.apply(run, { ...targetFact("3"), location: undefined, pixel: undefined }),
    ).toBe("committed");
    const snapshot = await business.getContextSnapshot(scope);
    const targetObjects = snapshot?.objects.filter(
      (item) => item.kind === "artifact" && item.value.artifactType === "target.object",
    );
    expect(targetObjects).toHaveLength(3);
    const first = targetObjects?.find(
      (item) => item.kind === "artifact" && item.value.source.sourceRecordRef === "1",
    );
    expect(first).toMatchObject({
      kind: "artifact",
      value: {
        availability: "available",
        content: { kind: "geojson", geometry: { type: "Point" } },
        representations: {
          image: { kind: "image_observation", bbox: { coordinateMode: "pixel" } },
        },
      },
    });
    const id = first?.kind === "artifact" ? first.value.artifactId : "";
    expect(id).toMatch(/^target-[a-f0-9]{32}$/);
    expect(
      targetObjects?.find(
        (item) => item.kind === "artifact" && item.value.source.sourceRecordRef === "3",
      ),
    ).toMatchObject({ value: { availability: "unavailable" } });
    expect(events).toHaveLength(3);
    await expect(
      processor.apply(run, { ...targetFact("1"), location: { longitude: 117, latitude: 40 } }),
    ).rejects.toThrow("TARGET_SOURCE_VERSION_CONFLICT");
    expect(
      await processor.apply(run, {
        ...targetFact("1"),
        sourceRevision: String(captureTimeUs + 1_000_000),
        observedAt: "2026-09-24T00:00:03Z",
        trackingState: "locked",
      }),
    ).toBe("committed");
    expect((await business.getArtifactLatest(scope, id))?.revision).toBe(2);
    expect((await business.getArtifactVersion(scope, id, 1))?.properties).toMatchObject({
      trackingState: "unknown",
    });
  });

  it("keeps Context time monotonic when another target's older capture arrives later", async () => {
    const { run, business, processor, scope } = await setup();
    expect(
      await processor.apply(run, {
        ...targetFact("recent"),
        sourceRevision: String(captureTimeUs + 1_000_000),
        observedAt: "2026-09-24T00:00:03Z",
      }),
    ).toBe("committed");
    expect(await processor.apply(run, targetFact("late"))).toBe("committed");

    const snapshot = await business.getContextSnapshot(scope);
    expect(snapshot?.context.updatedAt).toBe("2026-09-24T00:00:03Z");
    expect(snapshot?.context.contextRevision).toBe(3);
    expect(
      snapshot?.objects.find(
        (item) =>
          item.kind === "artifact" &&
          item.value.artifactType === "target.object" &&
          item.value.source.sourceRecordRef === "late",
      ),
    ).toMatchObject({
      value: { createdAt: "2026-09-24T00:00:02Z", updatedAt: "2026-09-24T00:00:02Z" },
    });
  });

  it("does not let an older microsecond capture replace a target in the same millisecond", async () => {
    const { run, business, processor, events, scope } = await setup();
    const first = {
      ...targetFact("7"),
      sourceRevision: String(captureTimeUs + 900),
    };
    expect(await processor.apply(run, first)).toBe("committed");
    const prior = await business.getContext(scope);
    const targetRef = prior?.artifactRefs.find((ref) => ref.id.startsWith("target-"));
    const target = await business.getArtifactLatest(scope, targetRef?.id ?? "");
    const eventCount = events.length;
    expect(
      await processor.apply(run, {
        ...first,
        sourceRevision: String(captureTimeUs + 100),
        visibility: "lost",
        location: undefined,
        pixel: undefined,
      }),
    ).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(prior);
    expect(await business.getArtifactLatest(scope, targetRef?.id ?? "")).toEqual(target);
    expect(events).toHaveLength(eventCount);
    expect(
      await processor.apply(run, {
        ...first,
        sourceRevision: String(captureTimeUs + 950),
        confidence: 0.8,
      }),
    ).toBe("committed");
    expect(await business.getArtifactLatest(scope, targetRef?.id ?? "")).toMatchObject({
      revision: 2,
      properties: { visibility: "visible", confidence: 0.8 },
    });
  });

  it("keeps an aged last position on loss and splits only measured track segments", async () => {
    const { run, business, processor, scope } = await setup();
    const sample = (second: number, longitude: number) => ({
      ...targetFact("1"),
      sourceRevision: String(captureTimeUs + (second - 2) * 1_000_000),
      observedAt: `2026-09-24T00:00:0${second}Z`,
      location: { longitude, latitude: 39 },
    });
    await processor.apply(run, sample(2, 116));
    let snapshot = await business.getContextSnapshot(scope);
    expect(
      snapshot?.objects.some(
        (item) => item.kind === "artifact" && item.value.artifactType === "target.track",
      ),
    ).toBe(false);
    await processor.apply(run, sample(3, 116.001));
    snapshot = await business.getContextSnapshot(scope);
    const firstTrack = snapshot?.objects.find(
      (item) => item.kind === "artifact" && item.value.artifactType === "target.track",
    );
    expect(firstTrack).toMatchObject({
      value: {
        revision: 1,
        semantics: "observed",
        properties: { sampleCount: 2 },
        content: {
          geometry: {
            type: "LineString",
            coordinates: [
              [116, 39],
              [116.001, 39],
            ],
          },
        },
      },
    });
    const targetId = snapshot?.objects.find(
      (item) => item.kind === "artifact" && item.value.artifactType === "target.object",
    );
    const id = targetId?.kind === "artifact" ? targetId.value.artifactId : "";
    await processor.apply(run, sample(4, 116.002));
    await processor.apply(run, {
      ...sample(4, 116.002),
      sourceRevision: "metadata-4",
      confidence: 0.8,
    });
    expect((await business.getContext(scope))?.activeRefs[`targetTrack:${id}`]).toBeDefined();
    expect(
      (
        await business.getArtifactLatest(
          scope,
          firstTrack?.kind === "artifact" ? firstTrack.value.artifactId : "",
        )
      )?.properties,
    ).toMatchObject({ sampleCount: 3 });
    await expect(
      processor.apply(run, { ...sample(4, 117), sourceRevision: "conflicting-position-4" }),
    ).rejects.toThrow("TARGET_SAME_TIME_POSITION_CONFLICT");
    await processor.apply(run, {
      ...sample(5, 117),
      location: undefined,
      pixel: undefined,
      visibility: "lost",
    });
    const lost = await business.getArtifactLatest(scope, id);
    expect(lost).toMatchObject({
      availability: "available",
      content: { geometry: { type: "Point", coordinates: [116.002, 39] } },
      updatedAt: "2026-09-24T00:00:05Z",
      properties: {
        visibility: "lost",
        trackingState: "unknown",
        lastSeen: { observedAt: "2026-09-24T00:00:04Z" },
      },
    });
    expect((await business.getContext(scope))?.activeRefs[`targetTrack:${id}`]).toBeUndefined();
    expect(
      await processor.apply(run, {
        ...sample(5, 117),
        location: undefined,
        pixel: undefined,
        visibility: "lost",
      }),
    ).toBe("duplicate");
    await processor.apply(run, sample(6, 116.003));
    expect((await business.getContext(scope))?.activeRefs[`targetTrack:${id}`]).toBeUndefined();
    await processor.apply(run, sample(7, 116.004));
    snapshot = await business.getContextSnapshot(scope);
    const tracks = snapshot?.objects.filter(
      (item) => item.kind === "artifact" && item.value.artifactType === "target.track",
    );
    expect(
      new Set(tracks?.map((item) => (item.kind === "artifact" ? item.value.artifactId : ""))),
    ).toHaveProperty("size", 2);
    const newTrackRef = (await business.getContext(scope))?.activeRefs[`targetTrack:${id}`];
    expect(newTrackRef?.id).not.toBe(
      firstTrack?.kind === "artifact" ? firstTrack.value.artifactId : "",
    );
    expect(await business.getArtifactLatest(scope, newTrackRef?.id ?? "")).toMatchObject({
      properties: { sampleCount: 2 },
      content: {
        geometry: {
          coordinates: [
            [116.003, 39],
            [116.004, 39],
          ],
        },
      },
    });
    expect((await business.getArtifactLatest(scope, id))?.properties).toMatchObject({
      firstSeen: { observedAt: "2026-09-24T00:00:02Z" },
      lastSeen: { observedAt: "2026-09-24T00:00:07Z" },
    });
  });

  it("closes an active track when a same-time loss repeats the last measured position", async () => {
    const { run, business, processor, scope } = await setup();
    await processor.apply(run, targetFact("loss-with-position"));
    await processor.apply(run, {
      ...targetFact("loss-with-position"),
      sourceRevision: String(captureTimeUs + 1_000_000),
      observedAt: "2026-09-24T00:00:03Z",
      location: { longitude: 116.001, latitude: 39 },
    });
    const before = await business.getContextSnapshot(scope);
    const target = before?.objects.find(
      (item) => item.kind === "artifact" && item.value.artifactType === "target.object",
    );
    const targetId = target?.kind === "artifact" ? target.value.artifactId : "";
    const trackRef = before?.context.activeRefs[`targetTrack:${targetId}`];
    expect(trackRef).toBeDefined();

    expect(
      await processor.apply(run, {
        ...targetFact("loss-with-position"),
        sourceRevision: "loss-after-last-sample",
        observedAt: "2026-09-24T00:00:03Z",
        location: { longitude: 116.001, latitude: 39 },
        visibility: "lost",
        trackingState: "lost",
      }),
    ).toBe("committed");
    const after = await business.getContextSnapshot(scope);
    expect(after?.context.activeRefs[`targetTrack:${targetId}`]).toBeUndefined();
    expect(after?.context.artifactRefs).toContainEqual(trackRef);
    expect(await business.getArtifactLatest(scope, targetId)).toMatchObject({
      properties: {
        visibility: "lost",
        lastSeen: { observedAt: "2026-09-24T00:00:03Z" },
      },
    });
  });

  it("keeps unknown renumbering and a new scene in separate identities", async () => {
    const { run, executions, business, service, processor, scope } = await setup();
    await processor.apply(run, targetFact("1"));
    await processor.apply(run, targetFact("9"));
    const first = await business.getContextSnapshot(scope);
    const originalIds = first?.objects
      .filter((item) => item.kind === "artifact" && item.value.artifactType === "target.object")
      .map((item) => (item.kind === "artifact" ? item.value.artifactId : ""));
    expect(new Set(originalIds).size).toBe(2);
    const nextRun: ProviderExecution = {
      ...run,
      taskId: "task-targets-b",
      externalExecutionId: "execution-targets-b",
      downstreamMissionIds: ["mission-2"],
      executionContext: { ...run.executionContext, simulationId: "scene-b" },
    };
    await executions.putExecution(nextRun);
    await service.ensureForCreatedExecution(nextRun.taskId);
    await processor.apply(nextRun, {
      ...targetFact("1"),
      missionId: "mission-2",
      observationSessionId: "mission-2",
    });
    const next = await business.getContextSnapshot(BoundExecutionScope.fromExecution(nextRun));
    const nextId = next?.objects.find(
      (item) => item.kind === "artifact" && item.value.artifactType === "target.object",
    );
    expect(originalIds).not.toContain(nextId?.kind === "artifact" ? nextId.value.artifactId : "");
    expect((await business.getContextSnapshot(scope))?.objects).toEqual(first?.objects);
  });

  it("projects three mission-bound MQTT targets through a uniquely bound recon session", async () => {
    const { run, executions, business, service, scope } = await setup();
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65_536,
      maxDepth: 16,
      maxNodes: 4_096,
      maxStringBytes: 16_384,
    });
    const device = new MockUgvDeviceMcpClient();
    const deviceCalls = vi.spyOn(device, "call");
    const runtime = new UgvProviderRuntime(
      {
        providerId: run.providerId ?? "provider-a",
        resourceId: run.resourceId,
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
        now: () => new Date("2026-09-24T00:00:10Z"),
        businessManualDecision: {
          maxWaitMs: 30_000,
          onExpire: "release_and_resume_scan",
          onDismiss: "release_and_resume_scan",
        },
      },
      executions,
      ingress,
      device,
      new UgvBusinessEventHub(executions),
      new UgvTelemetry({
        providerId: run.providerId ?? "provider-a",
        enabled: false,
        endpoint: "127.0.0.1:7002",
        tlsMode: "disabled",
      }),
      service,
    );
    try {
      await runtime.initializeLocal();
      ingress.handle(
        "/ugv/area_recon/status",
        Buffer.from(
          JSON.stringify({
            header: { stamp: { sec: Date.parse("2026-09-24T00:00:01Z") / 1000, nanosec: 0 } },
            mission_id: "mission-1",
            status: 5,
            lock: { stage: 3, target_id: 1 },
          }),
        ),
        false,
        "2026-09-24T00:00:01Z",
      );
      ingress.handle(
        "/ugv/area_recon/targets",
        Buffer.from(
          JSON.stringify({
            mission_id: "mission-1",
            targets: [
              {
                target_id: 1,
                capture_time_us: captureTimeUs,
                position: { longitude: 116, latitude: 39 },
                pixel_pos: { x: 10, y: 20, w: 30, h: 40 },
              },
              {
                target_id: 2,
                capture_time_us: captureTimeUs,
                pixel_pos: { x: 50, y: 60, w: 10, h: 12 },
              },
              { target_id: 3, capture_time_us: captureTimeUs },
            ],
          }),
        ),
        false,
        "2026-09-24T00:00:02Z",
      );
      await vi.waitFor(async () => {
        const context = await business.getContext(scope);
        expect(context?.artifactRefs).toHaveLength(5);
      });
      expect((await service.activeRequiredInput(run))?.subjectBinding).toMatchObject({
        kind: "visual_lock",
        targetId: "1",
      });
      const snapshot = await business.getContextSnapshot(scope);
      const targetObjects = snapshot?.objects.filter(
        (item) => item.kind === "artifact" && item.value.artifactType === "target.object",
      );
      expect(targetObjects).toHaveLength(3);
      expect(
        targetObjects?.find(
          (item) => item.kind === "artifact" && item.value.source.sourceRecordRef === "1",
        ),
      ).toMatchObject({ value: { properties: { trackingState: "unknown" } } });
      ingress.handle(
        "/ugv/area_recon/status",
        Buffer.from(
          JSON.stringify({
            header: {
              stamp: { sec: Date.parse("2026-09-24T00:00:02Z") / 1000, nanosec: 500_000_000 },
            },
            mission_id: "mission-1",
            status: 5,
            lock: { stage: 3, target_id: 1 },
          }),
        ),
        false,
        "2026-09-24T00:00:02.500Z",
      );
      await vi.waitFor(async () => {
        const current = await business.getContextSnapshot(scope);
        const active = current?.context.activeRefs["visualLock:mission-1"];
        const version = current?.objects.find(
          (item) =>
            item.kind === "action" &&
            item.value.actionId === active?.id &&
            item.value.revision === active.revision,
        );
        expect(version).toMatchObject({
          value: { state: "active", subjectRefs: [{ kind: "artifact" }] },
        });
      });
      expect(
        deviceCalls.mock.calls.filter(([name]) => name === "ugv_area_recon_lock"),
      ).toHaveLength(0);
      const firstId = targetObjects?.find(
        (item) => item.kind === "artifact" && item.value.source.sourceRecordRef === "1",
      );
      ingress.handle(
        "/ugv/area_recon/targets",
        Buffer.from(
          JSON.stringify({
            mission_id: "mission-1",
            targets: [
              {
                target_id: 1,
                capture_time_us: captureTimeUs + 1_000_000,
                position: { longitude: 116.001, latitude: 39 },
              },
            ],
          }),
        ),
        false,
        "2026-09-24T00:00:03Z",
      );
      await vi.waitFor(async () => {
        const latest = await business.getArtifactLatest(
          scope,
          firstId?.kind === "artifact" ? firstId.value.artifactId : "",
        );
        expect(latest?.revision).toBe(2);
        const target2 = targetObjects?.find(
          (item) => item.kind === "artifact" && item.value.source.sourceRecordRef === "2",
        );
        expect(
          (
            await business.getArtifactLatest(
              scope,
              target2?.kind === "artifact" ? target2.value.artifactId : "",
            )
          )?.revision,
        ).toBe(2);
      });
      const afterLoss = await business.getContextSnapshot(scope);
      const latestTargets = new Map<string, { revision: number; visibility: unknown }>();
      for (const item of afterLoss?.objects ?? []) {
        if (item.kind !== "artifact" || item.value.artifactType !== "target.object") continue;
        const sourceId = item.value.source.sourceRecordRef ?? "";
        const prior = latestTargets.get(sourceId);
        if (prior === undefined || prior.revision < item.value.revision)
          latestTargets.set(sourceId, {
            revision: item.value.revision,
            visibility:
              item.value.properties && "visibility" in item.value.properties
                ? item.value.properties.visibility
                : undefined,
          });
      }
      expect(latestTargets.get("1")?.visibility).toBe("visible");
      expect(latestTargets.get("2")?.visibility).toBe("lost");
      expect(latestTargets.get("3")?.visibility).toBe("lost");
      expect(
        afterLoss?.objects.some(
          (item) => item.kind === "artifact" && item.value.artifactType === "target.track",
        ),
      ).toBe(true);
      const target2Id = targetObjects?.find(
        (item) => item.kind === "artifact" && item.value.source.sourceRecordRef === "2",
      );
      ingress.handle(
        "/ugv/area_recon/targets",
        Buffer.from(
          JSON.stringify({
            mission_id: "mission-1",
            targets: [
              {
                target_id: 2,
                capture_time_us: captureTimeUs + 2_000_000,
                pixel_pos: { x: 55, y: 65, w: 10, h: 12 },
              },
            ],
          }),
        ),
        false,
        "2026-09-24T00:00:04Z",
      );
      await vi.waitFor(async () => {
        const latest = await business.getArtifactLatest(
          scope,
          target2Id?.kind === "artifact" ? target2Id.value.artifactId : "",
        );
        expect(latest?.properties).toMatchObject({ visibility: "visible" });
        expect(latest?.revision).toBe(3);
      });
      await vi.waitFor(async () => {
        expect(await service.activeRequiredInput(run)).toBeUndefined();
        expect((await executions.getExecution(run.taskId))?.state).toBe("RUNNING");
      });
      ingress.handle(
        "/ugv/area_recon/targets",
        Buffer.from(
          JSON.stringify({
            mission_id: "mission-1",
            header: { stamp: { sec: Date.parse("2026-09-24T00:00:05Z") / 1000, nanosec: 0 } },
            targets: [],
          }),
        ),
        false,
        "2026-09-24T00:00:05Z",
      );
      await vi.waitFor(async () => {
        const latest = await business.getArtifactLatest(
          scope,
          target2Id?.kind === "artifact" ? target2Id.value.artifactId : "",
        );
        expect(latest?.revision).toBe(4);
        expect(latest?.properties).toMatchObject({
          visibility: "lost",
          lastSeen: { observedAt: "2026-09-24T00:00:04.000Z" },
        });
      });
    } finally {
      await runtime.close();
    }
  });

  it("projects valid peers after one target conflicts and does not infer loss from that batch", async () => {
    const { run, executions, business, service, scope } = await setup();
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65_536,
      maxDepth: 16,
      maxNodes: 4_096,
      maxStringBytes: 16_384,
    });
    const telemetry = new UgvTelemetry({
      providerId: run.providerId ?? "provider-a",
      enabled: false,
      endpoint: "127.0.0.1:7002",
      tlsMode: "disabled",
    });
    const runtime = new UgvProviderRuntime(
      {
        providerId: run.providerId ?? "provider-a",
        resourceId: run.resourceId,
        freshness: { chassis: 3_000, mission: 3_000, health: 5_000, target: 3_000, payload: 3_000 },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        pollIntervalMs: 60_000,
      },
      executions,
      ingress,
      new MockUgvDeviceMcpClient(),
      new UgvBusinessEventHub(executions),
      telemetry,
      service,
    );
    const publishTargets = (targets: Record<string, unknown>[], receivedAt: string) =>
      ingress.handle(
        "/ugv/area_recon/targets",
        Buffer.from(JSON.stringify({ mission_id: "mission-1", targets })),
        false,
        receivedAt,
      );
    try {
      await runtime.initializeLocal();
      ingress.handle(
        "/ugv/area_recon/status",
        Buffer.from(
          JSON.stringify({
            header: { stamp: { sec: Date.parse("2026-09-24T00:00:01Z") / 1000, nanosec: 0 } },
            mission_id: "mission-1",
            status: 5,
          }),
        ),
        false,
        "2026-09-24T00:00:01Z",
      );
      publishTargets(
        [
          {
            target_id: 1,
            capture_time_us: captureTimeUs,
            position: { longitude: 116, latitude: 39 },
          },
          {
            target_id: 2,
            capture_time_us: captureTimeUs,
            position: { longitude: 117, latitude: 39 },
          },
        ],
        "2026-09-24T00:00:02Z",
      );
      await vi.waitFor(async () => {
        expect(
          (await business.getContextSnapshot(scope))?.objects.filter(
            (item) => item.kind === "artifact" && item.value.artifactType === "target.object",
          ),
        ).toHaveLength(2);
      });

      publishTargets(
        [
          {
            target_id: 1,
            capture_time_us: captureTimeUs,
            position: { longitude: 118, latitude: 39 },
          },
          {
            target_id: 3,
            capture_time_us: captureTimeUs + 1_000_000,
            position: { longitude: 119, latitude: 39 },
          },
        ],
        "2026-09-24T00:00:03Z",
      );
      await vi.waitFor(async () => {
        const snapshot = await business.getContextSnapshot(scope);
        expect(
          snapshot?.objects.some(
            (item) =>
              item.kind === "artifact" &&
              item.value.artifactType === "target.object" &&
              item.value.source.sourceRecordRef === "3",
          ),
        ).toBe(true);
      });
      const snapshot = await business.getContextSnapshot(scope);
      const second = snapshot?.objects.find(
        (item) =>
          item.kind === "artifact" &&
          item.value.artifactType === "target.object" &&
          item.value.source.sourceRecordRef === "2",
      );
      const latestSecond = await business.getArtifactLatest(
        scope,
        second?.kind === "artifact" ? second.value.artifactId : "",
      );
      expect(latestSecond).toMatchObject({
        revision: 1,
        properties: { visibility: "visible" },
      });
      expect(
        telemetry.records.some(
          (event) =>
            event.eventType === "RESOURCE_METRIC" &&
            event.payload.metricName === "target_projection_conflict_total" &&
            event.payload.quality === "TARGET_SOURCE_VERSION_CONFLICT",
        ),
      ).toBe(true);
    } finally {
      await runtime.close();
    }
  });
});
