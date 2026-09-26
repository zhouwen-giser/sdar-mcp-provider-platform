import * as grpc from "@grpc/grpc-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.js";
import {
  MemoryProviderStore,
  MemoryTaskBusinessStore,
  BoundExecutionScope,
} from "../../packages/provider-adapter-kit/src/index.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { TaskBusinessContextSchema } from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvProviderServer } from "../../apps/ugv-provider-adapter/src/server.js";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { NavigationBusinessProcessor } from "../../apps/ugv-provider-adapter/src/navigation-business-processor.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

describe("UGV Runtime business read assembly", () => {
  it("creates Context before returning accepted execution and reads it through the real Adapter server", async () => {
    const store = new MemoryProviderStore();
    const business = new MemoryTaskBusinessStore();
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65_536,
      maxDepth: 16,
      maxNodes: 4_096,
      maxStringBytes: 16_384,
    });
    ingress.setConnected(true);
    ingress.handle(
      "/ugv/gnss",
      Buffer.from('{"entity_id":"ugv1","latitude":30.1,"longitude":114.1}'),
    );
    ingress.handle(
      "/ugv/component_status",
      Buffer.from(
        '{"entity_id":"ugv1","power_battery":0,"lvbattery":0,"fuel":0,"water_temp":0,"motor":0,"sensor":0,"gnss":0,"comms":0,"weapon":0,"navigation":0}',
      ),
    );
    const device = new MockUgvDeviceMcpClient();
    const telemetry = new UgvTelemetry({
      providerId: "isr.vehicle.ugv.ugv1",
      enabled: false,
      endpoint: "127.0.0.1:7002",
      tlsMode: "disabled",
    });
    const events = new UgvBusinessEventHub(store);
    const service = new UgvTaskBusinessContextService(
      store,
      business,
      "isr.vehicle.ugv.ugv1",
      "vehicle:ugv1",
      () => undefined,
    );
    const runtime = new UgvProviderRuntime(
      {
        providerId: "isr.vehicle.ugv.ugv1",
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
      telemetry,
      service,
    );
    await runtime.initialize();
    cleanup.push(() => runtime.close());
    const server = new UgvProviderServer(
      {
        providerId: "isr.vehicle.ugv.ugv1",
        providerVersion: "1.0.0",
        host: "127.0.0.1",
        port: 0,
        tlsMode: "disabled",
      },
      runtime,
      store,
      events,
    );
    const port = await server.start();
    cleanup.push(() => server.close());
    const gateway = new GrpcAdapterGateway({
      endpoint: `127.0.0.1:${String(port)}`,
      providerId: "isr.vehicle.ugv.ugv1",
    });
    cleanup.push(() => gateway.close());
    const args = {
      resourceId: "vehicle:ugv1",
      mission: { type: "point", target: { latitude: 30.2, longitude: 114.2 } },
      speedLimitKmh: 20,
      stopOnObstacle: true,
    };
    const options = {
      taskId: "task-business-e2e",
      authorizationContextHash: "a".repeat(64),
      executionMode: "simulation" as const,
      simulationId: "scene-a",
      argumentHash: "b".repeat(64),
    };
    const dispatches = device.calls.length;
    vi.spyOn(service, "ensureForCreatedExecution").mockRejectedValueOnce(
      new Error("CONTEXT_STORAGE_UNAVAILABLE"),
    );
    const failedTaskId = "task-business-init-failed";
    expect(
      await gateway.startOperation("vehicle_navigate", args, { ...options, taskId: failedTaskId }),
    ).toMatchObject({
      result: "rejected",
      rejected: { reasonCode: "CONTEXT_STORAGE_UNAVAILABLE" },
    });
    expect(device.calls).toHaveLength(dispatches);
    expect(await store.getExecution(failedTaskId)).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "BUSINESS_CONTEXT_INIT_FAILED",
      taskBusinessContextExpected: false,
    });
    const started = await gateway.startOperation("vehicle_navigate", args, options);
    expect(started.result).toBe("accepted");
    const externalId = started.accepted?.externalExecutionId;
    if (!externalId) throw new Error("EXECUTION_ID_MISSING");
    const persisted = await store.getExecution(options.taskId);
    if (!persisted) throw new Error("EXECUTION_MISSING");
    expect(persisted.taskBusinessContextExpected).toBe(true);
    expect(
      (await business.getContext(BoundExecutionScope.fromExecution(persisted)))?.contextRevision,
    ).toBe(1);
    const page = await gateway.getBusinessContext(options.taskId, externalId, 8_192, "", options);
    expect(page).toMatchObject({
      contextRevision: 1,
      context: { identity: { taskId: options.taskId, executionId: externalId } },
      objects: [{ kind: "artifact", value: { artifactType: "navigation.destination" } }],
    });
    await expect(
      gateway.getBusinessContext(options.taskId, externalId, 8_192, "", {
        ...options,
        simulationId: "scene-other",
      }),
    ).rejects.toMatchObject({
      code: grpc.status.NOT_FOUND,
      details: "BUSINESS_READ_SCOPE_MISMATCH",
    });
    await expect(
      gateway.getBusinessArtifact(
        options.taskId,
        externalId,
        "missing-route",
        undefined,
        "",
        false,
        options,
      ),
    ).rejects.toMatchObject({
      code: grpc.status.NOT_FOUND,
      details: "ARTIFACT_REVISION_NOT_FOUND",
    });

    // RUNTIME_WIRE fixture: the real planner source is not present in the UGV
    // southbound contract, so the adopted route is a labelled synthetic fact.
    const missionId = persisted.downstreamMissionIds.at(-1);
    if (!missionId) throw new Error("PERSISTED_MISSION_ID_MISSING");
    const planner = new NavigationBusinessProcessor(business, () => undefined);
    const planFact = {
      schemaVersion: "ugv.navigation-plan-fact/1",
      routeId: "route-wire-fixture",
      routePlanId: "plan-wire-fixture",
      routeRevision: 1,
      missionId,
      sourceRecordId: "planner-wire-fixture",
      routeSource: "test_double",
      adoption: "candidate" as "candidate" | "adopted",
      observedAt: new Date().toISOString(),
      content: {
        kind: "geojson",
        crs: "OGC:CRS84",
        geometry: {
          type: "LineString",
          coordinates: [
            [114.1, 30.1],
            [114.2, 30.2],
          ],
        },
      },
    };
    await planner.apply(persisted, planFact);
    await planner.apply(persisted, { ...planFact, adoption: "adopted" });
    const observationBase = Math.max(Date.now() - 10, Date.parse(persisted.createdAt) + 1);
    ingress.handle(
      "/ugv/mission_state",
      Buffer.from(JSON.stringify({ id: Number(missionId), state: 1, progress: 10 })),
      false,
      new Date(observationBase).toISOString(),
    );
    for (const [offset, longitude] of [
      [1, 114.11],
      [2, 114.12],
    ] as const)
      ingress.handle(
        "/ugv/gnss",
        Buffer.from(JSON.stringify({ latitude: 30.1, longitude })),
        false,
        new Date(observationBase + offset).toISOString(),
      );
    await runtime.pollActive();
    const projected = await gateway.getBusinessContext(
      options.taskId,
      externalId,
      16_384,
      "",
      options,
    );
    const projectedContext = TaskBusinessContextSchema.parse(projected.context);
    expect(projectedContext).toMatchObject({
      effectivePlanRevision: 1,
      activeRefs: {
        route: { id: "route-wire-fixture", revision: 2 },
        trajectory: { kind: "artifact", revision: 2 },
      },
    });
    const trajectory = projectedContext.activeRefs.trajectory;
    if (!trajectory) throw new Error("WIRE_TRAJECTORY_MISSING");
    expect(
      (
        await gateway.getBusinessArtifact(
          options.taskId,
          externalId,
          trajectory.id,
          trajectory.revision,
          "",
          false,
          options,
        )
      ).artifact,
    ).toMatchObject({
      artifactType: "navigation.trajectory",
      semantics: "observed",
      properties: { sampleCount: 2 },
      content: {
        geometry: {
          type: "LineString",
          coordinates: [
            [114.11, 30.1],
            [114.12, 30.1],
          ],
        },
      },
    });
    expect(
      (
        await gateway.getBusinessArtifact(
          options.taskId,
          externalId,
          "route-wire-fixture",
          2,
          "",
          false,
          options,
        )
      ).artifact,
    ).toMatchObject({
      artifactType: "navigation.route",
      properties: { adoption: "adopted" },
    });
    const manifest = await gateway.describeProvider();
    expect(
      manifest.operations.every(
        (item) =>
          item.businessFeedbackProfile === null || item.businessFeedbackProfile === undefined,
      ),
    ).toBe(true);
  });
});
