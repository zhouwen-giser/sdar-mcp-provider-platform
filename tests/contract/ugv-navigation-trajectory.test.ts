import { describe, expect, it } from "vitest";
import { NavigationTrajectoryProcessor } from "../../apps/ugv-provider-adapter/src/navigation-trajectory-processor.js";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { protoStructToJson } from "../../packages/adapter-protocol/src/struct.js";
import type { AdapterBusinessEvent } from "../../packages/adapter-protocol/src/types.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import {
  BoundExecutionScope,
  MemoryProviderStore,
  MemoryTaskBusinessStore,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { TaskBusinessFeedbackBodySchema } from "../../packages/vehicle-provider-core/src/task-business-contract.js";

const at = "2026-09-24T00:00:00Z";

function execution(taskId = "task-trajectory", missionId = "1"): ProviderExecution {
  return {
    taskId,
    externalExecutionId: `${taskId}-execution`,
    operationName: "vehicle_navigate",
    argumentHash: "b".repeat(64),
    providerId: "provider-a",
    resourceId: "vehicle:ugv1",
    tracks: [],
    arguments: {
      resourceId: "vehicle:ugv1",
      mission: { type: "point", target: { longitude: 116.2, latitude: 39.2 } },
    },
    executionContext: {
      authorizationContextHash: "a".repeat(64),
      executionMode: "SIMULATION",
      simulationId: "scene-a",
      correlationId: "correlation-a",
    },
    taskBusinessContextExpected: true,
    downstreamMissionIds: [missionId],
    state: "RUNNING",
    revision: 2,
    reasonCode: "UGV_MISSION_RUNNING",
    createdAt: at,
    updatedAt: at,
    evidence: [],
  };
}

function fact(second: number, longitude: number, cursor = `cursor-${second}`) {
  return {
    schemaVersion: "ugv.navigation-position-fact/1",
    missionId: "1",
    sourceCursor: cursor,
    sourceTopic: "/ugv/gnss",
    observedAt: `2026-09-24T00:00:${String(second).padStart(2, "0")}Z`,
    position: { longitude, latitude: 39 },
  };
}

async function setup() {
  const run = execution();
  const executions = new MemoryProviderStore();
  const business = new MemoryTaskBusinessStore();
  const events: unknown[] = [];
  await executions.putExecution(run);
  const service = new UgvTaskBusinessContextService(
    executions,
    business,
    run.providerId ?? "provider-a",
    run.resourceId,
    (event) => events.push(event),
  );
  await service.ensureForCreatedExecution(run.taskId);
  return {
    run,
    executions,
    business,
    service,
    events,
    scope: BoundExecutionScope.fromExecution(run),
  };
}

describe("mission-bound observed navigation trajectory", () => {
  it("keeps a legal first Point, dedupes cursors, avoids stationary geometry revisions and splits gaps", async () => {
    const { run, business, events, scope } = await setup();
    const processor = new NavigationTrajectoryProcessor(
      business,
      (event) => events.push(event),
      3_000,
    );
    expect(await processor.apply(run, fact(1, 116))).toBe("committed");
    const firstRef = (await business.getContext(scope))?.activeRefs.trajectory;
    expect(firstRef).toBeDefined();
    expect(await business.getArtifactLatest(scope, firstRef?.id ?? "")).toMatchObject({
      artifactType: "navigation.trajectory",
      semantics: "observed",
      properties: { sampleCount: 1 },
      content: { geometry: { type: "Point", coordinates: [116, 39] } },
    });
    expect(await processor.apply(run, fact(1, 116))).toBe("duplicate");
    await expect(processor.apply(run, fact(1, 116.1, "other-cursor"))).rejects.toThrow(
      "TRAJECTORY_SAME_TIME_POSITION_CONFLICT",
    );
    expect(await processor.apply(run, fact(2, 116.1))).toBe("committed");
    const lineRef = (await business.getContext(scope))?.activeRefs.trajectory;
    expect(lineRef).toMatchObject({ id: firstRef?.id, revision: 2 });
    expect(await business.getArtifactLatest(scope, firstRef?.id ?? "")).toMatchObject({
      properties: { sampleCount: 2 },
      content: {
        geometry: {
          type: "LineString",
          coordinates: [
            [116, 39],
            [116.1, 39],
          ],
        },
      },
    });
    const beforeStationaryEvents = events.length;
    expect(await processor.apply(run, fact(3, 116.1))).toBe("committed");
    expect(events).toHaveLength(beforeStationaryEvents);
    expect((await business.getContext(scope))?.activeRefs.trajectory).toEqual(lineRef);
    expect(await processor.apply(run, fact(7, 116.2))).toBe("committed");
    const newRef = (await business.getContext(scope))?.activeRefs.trajectory;
    expect(newRef?.id).not.toBe(firstRef?.id);
    expect(await business.getArtifactLatest(scope, newRef?.id ?? "")).toMatchObject({
      properties: { sampleCount: 1 },
      content: { geometry: { type: "Point", coordinates: [116.2, 39] } },
    });
    expect((await business.getContext(scope))?.artifactRefs).toContainEqual(lineRef);
    expect(await business.getArtifactVersion(scope, firstRef?.id ?? "", 1)).toMatchObject({
      properties: { sampleCount: 1 },
    });
    expect((await business.getContext(scope))?.effectivePlanRevision).toBe(0);
    await expect(processor.apply(run, { ...fact(8, 116.3), missionId: "2" })).rejects.toThrow(
      "TRAJECTORY_EXECUTION_BINDING_INVALID",
    );
  });

  it("orders distinct submillisecond positions and keeps the latest Context clock", async () => {
    const { run, business, scope } = await setup();
    const processor = new NavigationTrajectoryProcessor(business, () => undefined, 3_000);
    const precise = (suffix: string, longitude: number) => ({
      ...fact(1, longitude, `cursor-${suffix}`),
      observedAt: `2026-09-24T00:00:01.${suffix}Z`,
    });
    expect(await processor.apply(run, precise("000100", 116))).toBe("committed");
    expect(await processor.apply(run, precise("000900", 116.1))).toBe("committed");
    const lineRef = (await business.getContext(scope))?.activeRefs.trajectory;
    expect(await business.getArtifactLatest(scope, lineRef?.id ?? "")).toMatchObject({
      content: {
        geometry: {
          type: "LineString",
          coordinates: [
            [116, 39],
            [116.1, 39],
          ],
        },
      },
    });
    expect(await processor.apply(run, precise("000800", 115))).toBe("duplicate");
    expect(await processor.apply(run, precise("000950", 116.1))).toBe("committed");
    expect((await business.getContext(scope))?.updatedAt).toBe("2026-09-24T00:00:01.000950Z");
    expect((await business.getContext(scope))?.activeRefs.trajectory).toEqual(lineRef);
  });

  it("rejects a position earlier than Execution creation within the same millisecond", async () => {
    const { run, business } = await setup();
    const processor = new NavigationTrajectoryProcessor(business, () => undefined, 3_000);
    await expect(
      processor.apply(
        { ...run, createdAt: "2026-09-24T00:00:01.000900Z" },
        { ...fact(1, 116), observedAt: "2026-09-24T00:00:01.000100Z" },
      ),
    ).rejects.toThrow("TRAJECTORY_EXECUTION_BINDING_INVALID");
  });

  it("splits a trajectory when a fractional gap exceeds the millisecond limit", async () => {
    const { run, business, scope } = await setup();
    const processor = new NavigationTrajectoryProcessor(business, () => undefined, 3_000);
    await processor.apply(run, {
      ...fact(1, 116, "gap-first"),
      observedAt: "2026-09-24T00:00:01.000900Z",
    });
    const first = (await business.getContext(scope))?.activeRefs.trajectory;
    await processor.apply(run, {
      ...fact(4, 116.1, "gap-next"),
      observedAt: "2026-09-24T00:00:04.000901Z",
    });
    const next = (await business.getContext(scope))?.activeRefs.trajectory;
    expect(next?.id).not.toBe(first?.id);
  });

  it.each([
    ["SUCCEEDED", "UGV_MISSION_COMPLETED"],
    ["BUSINESS_FAILED", "UGV_MISSION_FAILED"],
    ["CANCELLED", "UGV_CANCELLED"],
  ] as const)("finalizes %s without rejudging the Provider result", async (state, reasonCode) => {
    const { run, business, service, scope, events } = await setup();
    const processor = new NavigationTrajectoryProcessor(business, () => undefined, 3_000);
    await processor.apply(run, fact(1, 116));
    const terminal = {
      ...run,
      state,
      reasonCode,
      terminalAt: "2026-09-24T00:00:02Z",
      updatedAt: "2026-09-24T00:00:02Z",
    };
    const beforeFinalizationEvents = events.length;
    await service.finalizeForTerminalExecution(terminal);
    await service.finalizeForTerminalExecution(terminal);
    const finalizationBodies = (
      events.slice(beforeFinalizationEvents) as AdapterBusinessEvent[]
    ).map((event) => TaskBusinessFeedbackBodySchema.parse(protoStructToJson(event.rawPayload)));
    expect(finalizationBodies).toHaveLength(2);
    expect(finalizationBodies[0]).toMatchObject({
      kind: "BUSINESS_EVENT",
      payload: {
        contextDelta: {
          phase: { code: `execution.${state.toLowerCase()}` },
          activeRefs: {},
          summary: { status: "finalized", resultCode: reasonCode },
        },
      },
    });
    expect(finalizationBodies[1]).toMatchObject({
      kind: "CONTEXT_FINALIZED",
      payload: { summary: { status: "finalized", resultCode: reasonCode } },
    });
    expect(finalizationBodies[0]?.contextRevision).toBe(finalizationBodies[1]?.contextRevision);
    expect(events.at(-1)).toMatchObject({
      rawPayload: {
        fields: {
          kind: { stringValue: "CONTEXT_FINALIZED" },
          payload: { structValue: { fields: { reasonCode: { stringValue: reasonCode } } } },
        },
      },
    });
    const context = await business.getContext(scope);
    expect(context).toMatchObject({
      summary: {
        status: "finalized",
        resultCode: reasonCode,
        properties: { executionState: state, unresolvedRefs: [] },
      },
      activeRefs: {},
      finalizedAt: "2026-09-24T00:00:02Z",
    });
    expect(context?.artifactRefs.some((ref) => ref.id.startsWith("trajectory-"))).toBe(true);
    expect(context?.contextRevision).toBe(3);
    await expect(processor.apply(run, fact(3, 116.1))).rejects.toThrow(
      "TRAJECTORY_CONTEXT_UNAVAILABLE",
    );
  });

  it("projects only accepted, fresh mission-owned GNSS from the runtime ingress", async () => {
    const { run, executions, business, service, scope } = await setup();
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65_536,
      maxDepth: 16,
      maxNodes: 4_096,
      maxStringBytes: 16_384,
    });
    const runtime = new UgvProviderRuntime(
      {
        providerId: run.providerId ?? "provider-a",
        resourceId: run.resourceId,
        freshness: { chassis: 3_000, mission: 3_000, health: 5_000, target: 3_000, payload: 3_000 },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        pollIntervalMs: 60_000,
        now: () => new Date("2026-09-24T00:00:03Z"),
      },
      executions,
      ingress,
      new MockUgvDeviceMcpClient(),
      new UgvBusinessEventHub(executions),
      new UgvTelemetry({
        providerId: run.providerId ?? "provider-a",
        enabled: false,
        endpoint: "127.0.0.1:7002",
        tlsMode: "disabled",
      }),
      service,
    );
    const send = (topic: string, body: Record<string, unknown>, second: number, retained = false) =>
      ingress.handle(
        topic,
        Buffer.from(JSON.stringify(body)),
        retained,
        `2026-09-24T00:00:${String(second).padStart(2, "0")}Z`,
      );
    try {
      await runtime.initializeLocal();
      send("/ugv/gnss", { latitude: 39, longitude: 115 }, 0);
      await runtime.pollActive();
      expect((await business.getContext(scope))?.activeRefs.trajectory).toBeUndefined();
      send("/ugv/mission_state", { id: 2, state: 1, progress: 10 }, 1);
      send("/ugv/gnss", { latitude: 39, longitude: 116 }, 2);
      await runtime.pollActive();
      expect((await business.getContext(scope))?.activeRefs.trajectory).toBeUndefined();
      send("/ugv/mission_state", { id: 1, state: 1, progress: 10 }, 2);
      send("/ugv/gnss", { latitude: 39, longitude: 116.1 }, 3);
      await runtime.pollActive();
      const ref = (await business.getContext(scope))?.activeRefs.trajectory;
      expect(ref).toBeDefined();
      expect(await business.getArtifactLatest(scope, ref?.id ?? "")).toMatchObject({
        content: { geometry: { type: "Point", coordinates: [116.1, 39] } },
      });
      expect((await business.getContext(scope))?.effectivePlanRevision).toBe(0);
      const sourceSecond = Date.parse("2026-09-24T00:00:03Z") / 1000;
      const preciseGnss = (nanosec: number, longitude: number) =>
        send(
          "/ugv/gnss",
          {
            header: { stamp: { sec: sourceSecond, nanosec } },
            latitude: 39,
            longitude,
          },
          3,
        );
      preciseGnss(100_000, 116.2);
      preciseGnss(900_000, 116.3);
      const lastRevision = ingress.snapshot().revision;
      expect(preciseGnss(200_000, 115)).toMatchObject({
        olderObservation: true,
        revision: lastRevision,
      });
      await runtime.pollActive();
      const preciseRef = (await business.getContext(scope))?.activeRefs.trajectory;
      expect(await business.getArtifactLatest(scope, preciseRef?.id ?? "")).toMatchObject({
        content: {
          geometry: {
            type: "LineString",
            coordinates: [
              [116.1, 39],
              [116.2, 39],
              [116.3, 39],
            ],
          },
        },
      });
      expect((await business.getContext(scope))?.updatedAt).toBe("2026-09-24T00:00:03.0009Z");
    } finally {
      await runtime.close();
    }
  });
});
