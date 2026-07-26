import { afterEach, describe, expect, it } from "vitest";
import { jsonToProtoStruct } from "../../packages/adapter-protocol/src/index.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import {
  UgvProviderRuntime,
  type CommandIdentity,
} from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";

const active: UgvProviderRuntime[] = [];
afterEach(async () => {
  while (active.length > 0) await active.pop()?.close();
});

describe("UGV long-running operation integration", () => {
  it("confirms navigate progress, pause/resume, completion and durable event replay", async () => {
    const fixture = await createFixture();
    const started = await fixture.runtime.start(
      startInput("nav-1", "vehicle_navigate", navigateArgs()),
    );
    expect(fixture.device.calls.map((call) => call.name)).toEqual(["ugv_path_follow_mission"]);
    expect(started.initialSnapshot).toMatchObject({ state: "ACCEPTED" });

    mission(fixture.ingress, 1, 25);
    let execution = await fixture.runtime.get("nav-1");
    expect(execution).toMatchObject({ state: "RUNNING", progress: 25 });

    const identity = identityOf(required(execution), "1");
    expect(await fixture.runtime.command("pause", identity)).toMatchObject({ accepted: true });
    mission(fixture.ingress, 2, 30);
    execution = await fixture.runtime.get("nav-1");
    expect(execution?.state).toBe("PAUSED");

    expect(
      await fixture.runtime.command("pause", identity),
      "same command sequence must replay the exact persisted ack",
    ).toEqual(await fixture.runtime.command("pause", identity));
    expect(
      await fixture.runtime.command("resume", identityOf(required(execution), "2")),
    ).toMatchObject({ accepted: true });
    mission(fixture.ingress, 1, 60);
    expect((await fixture.runtime.get("nav-1"))?.state).toBe("RUNNING");
    mission(fixture.ingress, 4, 100);
    execution = await fixture.runtime.get("nav-1");
    expect(execution).toMatchObject({ state: "SUCCEEDED", progress: 100 });
    expect(execution?.result).toMatchObject({ resourceId: "vehicle:ugv1", status: "completed" });

    const source = required(fixture.store.businessEventSources()[0]);
    const replay = await fixture.store.replayBusinessEvents(
      source.sourceId,
      source.sourceStreamId,
      0n,
    );
    expect(replay.map((event) => event.eventType)).toContain("vehicle.mission.started");
    expect(replay.map((event) => event.eventType)).toContain("vehicle.mission.completed");
  });

  it("waits for device cancellation confirmation instead of treating command ack as terminal", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("nav-cancel", "vehicle_navigate", navigateArgs()));
    mission(fixture.ingress, 1, 10);
    const running = await fixture.runtime.get("nav-cancel");
    const ack = await fixture.runtime.command("cancel", identityOf(required(running), "1"));
    expect(ack).toMatchObject({ accepted: true });
    expect((await fixture.runtime.get("nav-cancel"))?.state).toBe("STOPPING");
    mission(fixture.ingress, 3, 10);
    expect((await fixture.runtime.get("nav-cancel"))?.state).toBe("CANCELLED");
  });

  it("runs area recon and fails target tracking truthfully when lock is lost", async () => {
    const fixture = await createFixture(true);
    await fixture.runtime.start(startInput("recon-1", "vehicle_area_recon", reconArgs()));
    status(fixture.ingress, { eo: { state: 1, progress: 50 } });
    expect((await fixture.runtime.get("recon-1"))?.state).toBe("RUNNING");
    status(fixture.ingress, { eo: { state: 4, progress: 100 } });
    expect((await fixture.runtime.get("recon-1"))?.state).toBe("SUCCEEDED");

    await fixture.runtime.start(
      startInput("track-1", "vehicle_track_target", {
        resourceId: "vehicle:ugv1",
        targetId: "target-1",
        maintainLock: true,
        timeoutMs: 5000,
        desiredZoom: 2,
      }),
    );
    fixture.ingress.applyDeviceObservation(
      { payload: { lockedTargetId: "target-1", online: true } },
      ["payload"],
    );
    expect((await fixture.runtime.get("track-1"))?.state).toBe("RUNNING");
    fixture.ingress.applyDeviceObservation(
      { payload: { lockedTargetId: "other-target", online: true } },
      ["payload"],
    );
    expect(await fixture.runtime.get("track-1")).toMatchObject({
      state: "BUSINESS_FAILED",
      reasonCode: "UGV_TARGET_LOST",
    });
  });

  it("requires fire confirmation and strips destroyed/damage from every persisted output", async () => {
    const fixture = await createFixture(true);
    fixture.device.responses.set("ugv_attack_target", {
      accepted: true,
      destroyed: true,
      damage: 100,
      nested: { hit: true },
    });
    fixture.device.responses.set("ugv_area_recon_attack_confirm", {
      accepted: true,
      remaining_hp: 0,
    });
    fixture.ingress.applyDeviceObservation(
      {
        payload: {
          online: true,
          lockedTargetId: "target-1",
          attackReady: true,
          weapon: { state: 0, progress: 0 },
        },
      },
      ["payload"],
    );
    const started = await fixture.runtime.start(
      startInput("fire-1", "vehicle_fire_weapon", {
        resourceId: "vehicle:ugv1",
        targetId: "target-1",
        engagementMode: "single",
        requireConfirmation: true,
      }),
    );
    expect(started.initialSnapshot).toMatchObject({ state: "WAITING_INPUT" });
    expect(fixture.device.calls.some((call) => call.name === "ugv_attack_target")).toBe(false);

    const waiting = await fixture.runtime.get("fire-1");
    const ack = await fixture.runtime.updateFire(identityOf(required(waiting), "1"), [
      {
        key: "fire_confirmation",
        result: jsonToProtoStruct({ action: "accept", content: { confirmed: true } }),
      },
    ]);
    expect(ack).toMatchObject({ accepted: true, reasonCode: "UGV_FIRE_CONFIRMATION_ACCEPTED" });
    status(fixture.ingress, { weapon: { state: 4, progress: 100 } });
    const completed = await fixture.runtime.get("fire-1");
    expect(completed).toMatchObject({
      state: "SUCCEEDED",
      result: { status: "fire_cycle_completed" },
    });
    const persisted = JSON.stringify({ completed, telemetry: fixture.telemetry.records });
    expect(persisted).not.toMatch(/destroyed|damage|remaining_hp|\bhit\b/);
    expect(
      fixture.telemetry.records.some(
        (event) => event.payload.diagnostic === "fire_verdict_fields_stripped",
      ),
    ).toBe(true);
  });

  it("preempts active local chassis and EO tracks with an emergency stop", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("nav-active", "vehicle_navigate", navigateArgs()));
    await fixture.runtime.start(startInput("recon-active", "vehicle_area_recon", reconArgs()));
    const stopped = await fixture.runtime.start(
      startInput("stop-1", "vehicle_emergency_stop", { resourceId: "vehicle:ugv1" }),
    );
    expect(stopped.initialSnapshot).toMatchObject({ state: "ACCEPTED" });
    status(fixture.ingress, {});
    expect(await fixture.runtime.get("stop-1")).toMatchObject({
      state: "SUCCEEDED",
      result: { status: "stopped" },
    });
    expect(fixture.device.calls.slice(-4).map((call) => call.name)).toEqual([
      "ugv_stop",
      "ugv_mission_control",
      "ugv_area_recon_control",
      "ugv_area_recon_unlock",
    ]);
  });

  it("reconciles after restart without dispatching a duplicate side effect", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("recover-1", "vehicle_navigate", navigateArgs()));
    mission(fixture.ingress, 1, 40);
    await fixture.runtime.get("recover-1");
    const callsBeforeRestart = fixture.device.calls.length;
    await fixture.runtime.close();
    active.splice(active.indexOf(fixture.runtime), 1);

    const recovered = new UgvProviderRuntime(
      runtimeOptions(),
      fixture.store,
      fixture.ingress,
      fixture.device,
      fixture.events,
      fixture.telemetry,
    );
    active.push(recovered);
    await recovered.initialize();
    expect(fixture.device.calls).toHaveLength(callsBeforeRestart);
    const recoveredExecution = await recovered.get("recover-1");
    expect(recoveredExecution).toBeDefined();
    const result = await recovered.reconcile({
      ...startInput("recover-1", "vehicle_navigate", navigateArgs()),
      externalExecutionId: required(recoveredExecution).externalExecutionId,
    });
    expect(result).toMatchObject({ status: "FOUND", reasonCode: "EXECUTION_FOUND" });
  });
});

async function createFixture(withTarget = false) {
  const store = new MemoryProviderStore();
  const ingress = new VehicleMqttIngress("direct_domain_json", {
    maxPayloadBytes: 65536,
    maxDepth: 16,
    maxNodes: 4096,
    maxStringBytes: 16384,
  });
  ingress.setConnected(true);
  ingress.handle(
    "/ugv/gnss",
    Buffer.from('{"entity_id":"ugv1","latitude":30.1,"longitude":114.1,"altitude":10}'),
  );
  ingress.handle(
    "/ugv/component_status",
    Buffer.from(
      '{"entity_id":"ugv1","power_battery":0,"lvbattery":0,"fuel":0,"water_temp":0,"motor":0,"sensor":0,"gnss":0,"comms":0,"weapon":0,"navigation":0}',
    ),
  );
  status(ingress, {});
  if (withTarget)
    ingress.handle(
      "/ugv/detected_objects",
      Buffer.from(
        '{"entity_id":"ugv1","objects":[{"id":"target-1","object_type":"tank","x":1,"y":2,"z":0}]}',
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
  const runtime = new UgvProviderRuntime(
    runtimeOptions(),
    store,
    ingress,
    device,
    events,
    telemetry,
  );
  active.push(runtime);
  await runtime.initialize();
  return { store, ingress, device, telemetry, events, runtime };
}
function runtimeOptions() {
  return {
    providerId: "isr.vehicle.ugv.ugv1",
    freshness: { chassis: 3000, mission: 3000, health: 5000, target: 3000, payload: 3000 },
    allowNavigationWithRecon: true,
    fireRequiresChassisStopped: true,
    pollIntervalMs: 60_000,
  };
}
function startInput(
  taskId: string,
  operationName: string,
  argumentsValue: Record<string, unknown>,
) {
  return {
    taskId,
    operationName,
    arguments: argumentsValue,
    argumentHash: "a".repeat(64),
    executionContext: {
      authorizationContextHash: "b".repeat(64),
      executionMode: "SIMULATION",
      simulationId: "sim-1",
      correlationId: `correlation-${taskId}`,
    },
  };
}
function identityOf(
  execution: NonNullable<Awaited<ReturnType<UgvProviderRuntime["get"]>>>,
  sequence: string,
): CommandIdentity {
  return {
    taskId: execution.taskId,
    externalExecutionId: execution.externalExecutionId,
    operationName: execution.operationName,
    argumentHash: execution.argumentHash,
    executionContext: execution.executionContext,
    commandSequence: sequence,
  };
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("UGV_TEST_FIXTURE_VALUE_MISSING");
  return value;
}
function navigateArgs() {
  return {
    resourceId: "vehicle:ugv1",
    mission: { type: "point", target: { latitude: 30.2, longitude: 114.2 } },
    speedLimitKmh: 20,
    stopOnObstacle: true,
  };
}
function reconArgs() {
  return {
    resourceId: "vehicle:ugv1",
    area: {
      polygon: [
        { latitude: 30.1, longitude: 114.1 },
        { latitude: 30.1, longitude: 114.2 },
        { latitude: 30.2, longitude: 114.2 },
      ],
    },
    scanCount: 1,
    zoom: 1,
    stopOnTarget: false,
    targetTypes: ["tank"],
  };
}
function mission(ingress: VehicleMqttIngress, state: number, progress: number) {
  ingress.handle(
    "/ugv/mission_state",
    Buffer.from(JSON.stringify({ entity_id: "ugv1", id: "mission-1", type: 1, state, progress })),
  );
}
function status(
  ingress: VehicleMqttIngress,
  tracks: {
    chassis?: { state: number; progress: number };
    eo?: { state: number; progress: number };
    weapon?: { state: number; progress: number };
  },
) {
  ingress.handle(
    "/ugv/status",
    Buffer.from(
      JSON.stringify({
        vehicle_id: "ugv1",
        role_name: "ugv",
        speed_kmh: 0,
        chassis_task: tracks.chassis ?? { state: -1, progress: 0 },
        eo_task: tracks.eo ?? { state: -1, progress: 0 },
        weapon_task: tracks.weapon ?? { state: -1, progress: 0 },
        available: true,
      }),
    ),
  );
}
