import { jsonToProtoStruct } from "../../packages/adapter-protocol/src/index.js";
import {
  MemoryProviderStore,
  type VehicleCommandIdentity,
} from "../../packages/provider-adapter-kit/src/index.js";
import {
  MockNpcTankDeviceMcpClient,
  mockNpcTankToolContracts,
  type NpcTankDeviceToolName,
} from "../../packages/vehicle-device-mcp-client/src/index.js";
import {
  npcTankMqttProfile,
  VehicleMqttIngress,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";
import {
  VehicleBusinessEventHub,
  VehicleTelemetry,
  type NpcTankSnapshot,
} from "../../packages/vehicle-provider-core/src/index.js";
import { NpcTankProviderRuntime } from "../../apps/npc-tank-provider-adapter/src/runtime.js";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const active: NpcTankProviderRuntime[] = [];
afterEach(async () => {
  while (active.length > 0) await active.pop()?.close();
});

describe("NPC Tank navigation, controls and recovery", () => {
  it("uses primary navigation, confirms authoritative progress and replays events", async () => {
    const fixture = await createFixture();
    const started = await fixture.runtime.start(
      startInput("npc-nav-1", "vehicle_navigate", navigateArgs()),
    );
    expect(fixture.runtime.navigationSelection().selected).toBe("npc_tank_path_follow_mission");
    expect(fixture.device.calls.map((call) => call.name)).toEqual(["npc_tank_path_follow_mission"]);
    expect(started.initialSnapshot).toMatchObject({ state: "ACCEPTED" });
    mission(fixture.ingress, 1, 25);
    expect(await fixture.runtime.get("npc-nav-1")).toMatchObject({
      state: "RUNNING",
      progress: 25,
    });
    mission(fixture.ingress, 4, 100);
    expect(await fixture.runtime.get("npc-nav-1")).toMatchObject({
      state: "SUCCEEDED",
      result: { resourceId: "vehicle:npc_tank1", status: "completed" },
    });
    const source = required(fixture.store.businessEventSources()[0]);
    const events = await fixture.store.replayBusinessEvents(
      source.sourceId,
      source.sourceStreamId,
      0n,
    );
    expect(events.map((event) => event.eventType)).toEqual([
      "vehicle.mission.started",
      "vehicle.mission.completed",
    ]);
  });

  it("selects the fallback once at startup and never redispatches primary", async () => {
    const available = new Set<NpcTankDeviceToolName>(
      mockNpcTankToolContracts()
        .map((contract) => contract.name as NpcTankDeviceToolName)
        .filter((name) => name !== "npc_tank_path_follow_mission"),
    );
    const fixture = await createFixture({ available });
    expect(fixture.runtime.navigationSelection()).toMatchObject({
      selected: "npc_tank_send_waypoints",
      primaryValid: false,
      fallbackValid: true,
    });
    await fixture.runtime.start(startInput("npc-fallback", "vehicle_navigate", navigateArgs()));
    expect(fixture.device.calls.map((call) => call.name)).toEqual(["npc_tank_send_waypoints"]);
  });

  it("persists command-sequence idempotency for pause, resume and cancel", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("npc-control", "vehicle_navigate", navigateArgs()));
    mission(fixture.ingress, 1, 10);
    let execution = required(await fixture.runtime.get("npc-control"));
    const pauseIdentity = identityOf(execution, "1");
    const pause = await fixture.runtime.command("pause", pauseIdentity);
    expect(pause).toMatchObject({ accepted: true });
    expect(await fixture.runtime.command("pause", pauseIdentity)).toEqual(pause);
    mission(fixture.ingress, 2, 20);
    execution = required(await fixture.runtime.get("npc-control"));
    expect(await fixture.runtime.command("resume", identityOf(execution, "2"))).toMatchObject({
      accepted: true,
    });
    mission(fixture.ingress, 1, 30);
    execution = required(await fixture.runtime.get("npc-control"));
    expect(await fixture.runtime.command("cancel", identityOf(execution, "3"))).toMatchObject({
      accepted: true,
    });
    mission(fixture.ingress, 3, 30);
    expect((await fixture.runtime.get("npc-control"))?.state).toBe("CANCELLED");
  });

  it("does not let run_state or mode complete a mission and exposes authoritative conflict", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("npc-authority", "vehicle_navigate", navigateArgs()));
    fixture.ingress.handle(
      "/npc_tank1/system_state",
      Buffer.from(
        '{"entity_id":"npc_tank1","run_state":4,"mode":9,"speed_limit":20,"err_list":[]}',
      ),
    );
    expect((await fixture.runtime.get("npc-authority"))?.state).not.toBe("SUCCEEDED");
    fixture.ingress.handle(
      "/npc_tank1/mission_state",
      Buffer.from('{"entity_id":"npc_tank1","state":1,"progress":10}'),
    );
    fixture.ingress.handle(
      "/npc_tank1/status",
      Buffer.from(
        '{"vehicle_id":"npc_tank1","role_name":"npc_tank1","chassis_task":{"state":5,"progress":10},"available":true}',
      ),
    );
    const reconciled = await fixture.runtime.reconcile({
      ...startInput("npc-authority", "vehicle_navigate", navigateArgs()),
      externalExecutionId: required(await fixture.runtime.get("npc-authority")).externalExecutionId,
    });
    expect(reconciled).toMatchObject({
      status: "CONFLICT",
      reasonCode: "NPC_TASK_STATE_CONFLICT",
    });
  });

  it("recovers without repeating a navigation side effect", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("npc-restart", "vehicle_navigate", navigateArgs()));
    mission(fixture.ingress, 1, 40);
    await fixture.runtime.get("npc-restart");
    const callsBefore = fixture.device.calls.length;
    await fixture.runtime.close();
    active.splice(active.indexOf(fixture.runtime), 1);
    const recovered = new NpcTankProviderRuntime(
      runtimeOptions(),
      fixture.store,
      fixture.ingress,
      fixture.device,
      fixture.events,
      fixture.telemetry,
    );
    active.push(recovered);
    await recovered.initialize();
    expect(fixture.device.calls).toHaveLength(callsBefore);
    expect((await recovered.get("npc-restart"))?.externalExecutionId).toBe(
      required(await fixture.store.getExecution("npc-restart")).externalExecutionId,
    );
  });
});

describe("NPC Tank payload, circular EO and fire boundary", () => {
  it("runs base recon and advertises circular scan only with the complete contract", async () => {
    const fixture = await createFixture();
    expect(fixture.runtime.circularScanSupported()).toBe(true);
    await fixture.runtime.start(
      startInput("npc-circular", "vehicle_area_recon", reconArgs("circular")),
    );
    expect(fixture.device.calls.slice(-2).map((call) => call.name)).toEqual([
      "npc_tank_eo_set_angle",
      "npc_tank_eo_scan_start",
    ]);

    const available = new Set<NpcTankDeviceToolName>(
      mockNpcTankToolContracts()
        .map((contract) => contract.name as NpcTankDeviceToolName)
        .filter((name) => name !== "npc_tank_eo_set_angle"),
    );
    const without = await createFixture({ available });
    expect(without.runtime.circularScanSupported()).toBe(false);
    expect(without.runtime.availability("vehicle_area_recon", reconArgs("circular"))).toMatchObject(
      {
        availability: "DISABLED",
        reasonCode: "NPC_TANK_CIRCULAR_SCAN_UNSUPPORTED",
      },
    );
  });

  it("requires fire confirmation and strips every forbidden verdict before persistence", async () => {
    const fixture = await createFixture({ withTarget: true });
    fixture.device.responses.set("npc_tank_attack_target", {
      accepted: true,
      verdict: { hit: true, destroyed: true },
      damage: 100,
      remainingHp: 0,
      referee: { alive: false },
    });
    fixture.device.responses.set("npc_tank_area_recon_attack_confirm", {
      accepted: true,
      miss: false,
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
      startInput("npc-fire", "vehicle_fire_weapon", {
        resourceId: "vehicle:npc_tank1",
        targetId: "target-1",
        engagementMode: "single",
        requireConfirmation: true,
      }),
    );
    expect(started.initialSnapshot).toMatchObject({ state: "WAITING_INPUT" });
    expect(fixture.device.calls.some((call) => call.name === "npc_tank_attack_target")).toBe(false);
    const waiting = required(await fixture.runtime.get("npc-fire"));
    expect(
      await fixture.runtime.updateFire(identityOf(waiting, "1"), [
        {
          key: "fire_confirmation",
          result: jsonToProtoStruct({
            action: "accept",
            content: { confirmed: true },
          }),
        },
      ]),
    ).toMatchObject({
      accepted: true,
      reasonCode: "NPC_TANK_FIRE_CONFIRMATION_ACCEPTED",
    });
    status(fixture.ingress, { weapon: { state: 4, progress: 100 } });
    const completed = await fixture.runtime.get("npc-fire");
    expect(completed).toMatchObject({
      state: "SUCCEEDED",
      result: {
        status: "fire_cycle_completed",
        localOnly: true,
        confirmed: true,
        reasonCode: "NPC_TANK_FIRE_CYCLE_COMPLETED",
      },
    });
    expect(JSON.stringify({ completed, telemetry: fixture.telemetry.records })).not.toMatch(
      /"hit"|"miss"|"destroyed"|"damage"|"remainingHp"|"referee"|"verdict"/,
    );
  });
});

async function createFixture(
  options: {
    withTarget?: boolean;
    available?: Set<NpcTankDeviceToolName>;
  } = {},
) {
  const store = new MemoryProviderStore();
  const ingress = new VehicleMqttIngress<NpcTankSnapshot>(
    "direct_domain_json",
    { maxPayloadBytes: 65536, maxDepth: 16, maxNodes: 4096, maxStringBytes: 16384 },
    npcTankMqttProfile(),
  );
  seed(ingress, options.withTarget ?? false);
  const device = new MockNpcTankDeviceMcpClient(options.available);
  const telemetry = new VehicleTelemetry({
    providerId: "isr.vehicle.npc-tank.npc-tank1",
    resourceId: "vehicle:npc_tank1",
    resourceType: "isr.vehicle.npc_tank",
    enabled: false,
    endpoint: "127.0.0.1:7005",
    tlsMode: "disabled",
  });
  const events = new VehicleBusinessEventHub(store, {
    reasonPrefix: "NPC_TANK",
    resourceId: "vehicle:npc_tank1",
  });
  const runtime = new NpcTankProviderRuntime(
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
    providerId: "isr.vehicle.npc-tank.npc-tank1",
    providerVersion: "0.1.0",
    freshness: {
      chassis: 3000,
      mission: 3000,
      health: 5000,
      target: 3000,
      payload: 3000,
    },
    allowNavigationWithRecon: true,
    fireRequiresChassisStopped: true,
    pollIntervalMs: 60_000,
    navigationReportPath: resolve(
      tmpdir(),
      `sdar-npc-tank-${String(process.pid)}-test-navigation.json`,
    ),
    eoScanReportPath: resolve(tmpdir(), `sdar-npc-tank-${String(process.pid)}-test-eo.json`),
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
      simulationId: "sim-npc",
      correlationId: `correlation-${taskId}`,
    },
  };
}
function identityOf(
  execution: NonNullable<Awaited<ReturnType<NpcTankProviderRuntime["get"]>>>,
  sequence: string,
): VehicleCommandIdentity {
  return {
    taskId: execution.taskId,
    externalExecutionId: execution.externalExecutionId,
    operationName: execution.operationName,
    argumentHash: execution.argumentHash,
    executionContext: execution.executionContext,
    commandSequence: sequence,
  };
}
function navigateArgs() {
  return {
    resourceId: "vehicle:npc_tank1",
    mission: {
      type: "point",
      target: { latitude: 30.2, longitude: 114.2 },
    },
    speedLimitKmh: 20,
    stopOnObstacle: true,
  };
}
function reconArgs(scanMode: "area" | "sector" | "circular") {
  return {
    resourceId: "vehicle:npc_tank1",
    area: {
      polygon: [
        { latitude: 30.1, longitude: 114.1 },
        { latitude: 30.1, longitude: 114.2 },
        { latitude: 30.2, longitude: 114.2 },
      ],
    },
    scanMode,
    angle: 0,
    angleUnit: "deg",
    scanCount: 1,
    zoom: 1,
    stopOnTarget: false,
    targetTypes: ["tank"],
  };
}
function seed(ingress: VehicleMqttIngress<NpcTankSnapshot>, withTarget: boolean): void {
  ingress.setConnected(true);
  ingress.handle(
    "/npc_tank1/gnss",
    Buffer.from('{"entity_id":"npc_tank1","latitude":30.1,"longitude":114.1,"altitude":10}'),
  );
  ingress.handle(
    "/npc_tank1/component_status",
    Buffer.from(
      '{"entity_id":"npc_tank1","power_battery":0,"lvbattery":0,"fuel":0,"water_temp":0,"motor":0,"sensor":0,"gnss":0,"comms":0,"weapon":0,"navigation":0}',
    ),
  );
  status(ingress, {});
  if (withTarget)
    ingress.handle(
      "/npc_tank1/detected_objects",
      Buffer.from(
        '{"entity_id":"npc_tank1","objects":[{"id":"target-1","object_type":"tank","x":1,"y":2,"z":0}]}',
      ),
    );
}
function mission(
  ingress: VehicleMqttIngress<NpcTankSnapshot>,
  stateValue: number,
  progress: number,
) {
  status(ingress, { chassis: { state: stateValue, progress } });
  ingress.handle(
    "/npc_tank1/mission_state",
    Buffer.from(
      JSON.stringify({
        entity_id: "npc_tank1",
        id: "mission-1",
        type: 1,
        state: stateValue,
        progress,
      }),
    ),
  );
}
function status(
  ingress: VehicleMqttIngress<NpcTankSnapshot>,
  tracks: {
    chassis?: { state: number; progress: number };
    eo?: { state: number; progress: number };
    weapon?: { state: number; progress: number };
  },
) {
  ingress.handle(
    "/npc_tank1/status",
    Buffer.from(
      JSON.stringify({
        vehicle_id: "npc_tank1",
        role_name: "npc_tank1",
        speed_kmh: 0,
        chassis_task: tracks.chassis ?? { state: -1, progress: 0 },
        eo_task: tracks.eo ?? { state: -1, progress: 0 },
        weapon_task: tracks.weapon ?? { state: -1, progress: 0 },
        available: true,
      }),
    ),
  );
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("NPC_TANK_TEST_FIXTURE_VALUE_MISSING");
  return value;
}
