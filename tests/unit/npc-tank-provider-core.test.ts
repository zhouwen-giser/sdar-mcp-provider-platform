import { describe, expect, it } from "vitest";
import { loadNpcTankProviderConfig } from "../../apps/npc-tank-provider-adapter/src/config.js";
import {
  mockNpcTankToolContracts,
  npcCircularScanSupported,
  npcStartDeviceCalls,
  selectNpcNavigationTool,
} from "../../packages/vehicle-device-mcp-client/src/index.js";
import {
  checkVehicleAvailability,
  createNpcTankSnapshot,
  mapVehicleTaskState,
  sanitizeFireResult,
  TrackArbiter,
} from "../../packages/vehicle-provider-core/src/index.js";
import {
  assertExactNpcTankSubscriptions,
  exactNpcTankTopic,
  NPC_TANK_MQTT_TOPICS,
  npcTankMqttProfile,
  VehicleMqttIngress,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";

const limits = { maxPayloadBytes: 4096, maxDepth: 8, maxNodes: 128, maxStringBytes: 256 };

describe("NPC Tank profile, topic and normalization unit contract", () => {
  it("loads the fixed identity and independent endpoints", () => {
    const config = loadNpcTankProviderConfig({});
    expect(config).toMatchObject({
      PROVIDER_ID: "isr.vehicle.npc-tank.npc-tank1",
      ADAPTER_PORT: 7013,
      NPC_TANK_DEVICE_MCP_URL: "http://127.0.0.1:19003/mcp",
    });
    expect(config.NPC_TANK_ADAPTER_DATABASE_URL).toContain("npc_adapter");
    expect(config.NPC_TANK_ADAPTER_DATABASE_URL).not.toContain("ugv_adapter");
  });

  it("shares transition-only connectivity events with the qualified vehicle ingress", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", limits, npcTankMqttProfile());
    const topics: string[] = [];
    ingress.onSnapshot((_snapshot, topic) => topics.push(topic));
    const initialRevision = ingress.snapshot().revision;

    ingress.setConnected(false, "2026-08-10T06:00:00.000Z");
    const repeatedRevision = ingress.snapshot().revision;
    ingress.setDeviceConnected(true, "2026-08-10T06:00:01.000Z");

    expect(repeatedRevision).toBe(initialRevision);
    expect(ingress.snapshot().connectivity.deviceMcpConnected).toBe(true);
    expect(topics).toEqual(["device_mcp_connection"]);
  });

  it("allows exactly 18 captured NPC topics and rejects UGV, referee and wildcard topics", () => {
    expect(NPC_TANK_MQTT_TOPICS).toHaveLength(18);
    expect(() => assertExactNpcTankSubscriptions(NPC_TANK_MQTT_TOPICS)).not.toThrow();
    for (const topic of ["/ugv/status", "/npc_tank1/referee/status", "/npc_tank1/#", "#"])
      expect(exactNpcTankTopic(topic)).toBe(false);
    expect(() => assertExactNpcTankSubscriptions(["/npc_tank1/#"])).toThrow(
      "NPC_TANK_MQTT_TOPIC_NOT_ALLOWED",
    );
  });

  it("normalizes NPC identity and preserves mission state as authority", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", limits, npcTankMqttProfile());
    ingress.handle(
      "/npc_tank1/mission_state",
      Buffer.from('{"entity_id":"npc_tank1","id":"mission-1","type":1,"state":1,"progress":25}'),
    );
    ingress.handle(
      "/npc_tank1/system_state",
      Buffer.from(
        '{"entity_id":"npc_tank1","run_state":4,"mode":9,"speed_limit":20,"err_list":[]}',
      ),
    );
    expect(ingress.snapshot()).toMatchObject({
      identity: {
        resourceId: "vehicle:npc_tank1",
        entityId: "npc_tank1",
        vehicleType: "npc_tank",
      },
      chassis: { mission: { state: 1, progress: 25 } },
      health: { runState: 4, mode: 9 },
    });
  });

  it("detects conflicts only between authoritative public task tracks", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", limits, npcTankMqttProfile());
    ingress.handle(
      "/npc_tank1/mission_state",
      Buffer.from('{"entity_id":"npc_tank1","state":1,"progress":10}'),
    );
    ingress.handle(
      "/npc_tank1/status",
      Buffer.from(
        '{"vehicle_id":"npc_tank1","role_name":"npc_tank1","chassis_task":{"state":5,"progress":10},"available":true}',
      ),
    );
    expect(ingress.stateConflict()).toBe(true);
  });

  it("normalizes rich compatibility status without conflating EO and recon tracks", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", limits, npcTankMqttProfile());
    ingress.handle(
      "/npc_tank1/status",
      Buffer.from(
        JSON.stringify({
          vehicle_id: "npc_tank1",
          role_name: "npc_tank1",
          speed_kmh: 0,
          chassis_task: { id: "mock-npc-mission-1", state: 1, progress: 10 },
          eo_task: { id: "mock-npc-eo-1", state: 0, progress: 0 },
          weapon_task: { id: "mock-npc-fire-1", state: 0, progress: 0 },
          available: true,
        }),
      ),
    );

    expect(ingress.snapshot()).toMatchObject({
      chassis: { mission: { id: "mock-npc-mission-1", state: 1, progress: 10 } },
      payload: {
        eoTask: { id: "mock-npc-eo-1", state: 0, progress: 0 },
        reconnaissance: { state: "unknown", motionStatus: "unknown" },
        weapon: { id: "mock-npc-fire-1", state: 0, progress: 0 },
      },
    });
  });

  it("normalizes captured idle sentinels and rejects invalid progress", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", limits, npcTankMqttProfile());
    ingress.handle(
      "/npc_tank1/status",
      Buffer.from(
        JSON.stringify({
          vehicle_id: "npc_tank1",
          role_name: "npc_tank1",
          chassis_task: { id: -1, type: -1, state: 0, progress: 0 },
          available: true,
        }),
      ),
    );
    expect(ingress.snapshot().chassis.mission).toEqual({
      state: 0,
      progress: 0,
    });

    ingress.handle(
      "/npc_tank1/mission_state",
      Buffer.from(
        JSON.stringify({
          entity_id: "npc_tank1",
          id: "idle-mission",
          type: 1,
          state: 0,
          progress: 0,
        }),
      ),
    );
    expect(ingress.snapshot().chassis.mission).toEqual({
      id: "idle-mission",
      type: 1,
      state: 0,
      progress: 0,
    });

    expect(() =>
      ingress.handle(
        "/npc_tank1/status",
        Buffer.from(
          JSON.stringify({
            vehicle_id: "npc_tank1",
            role_name: "npc_tank1",
            eo_task: { state: 1, progress: -1 },
            available: true,
          }),
        ),
      ),
    ).toThrow("NPC_TANK_MQTT_TASK_PROGRESS_INVALID");
  });

  it("keeps the captured EO task distinct from reconnaissance state", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", limits, npcTankMqttProfile());
    ingress.handle(
      "/npc_tank1/status",
      Buffer.from(
        JSON.stringify({
          vehicle_id: "npc_tank1",
          role_name: "npc_tank1",
          eo_task: { id: "old-eo", state: 1, progress: 50 },
          available: true,
        }),
      ),
      false,
      "2026-08-10T06:00:00.000Z",
    );
    ingress.handle(
      "/npc_tank1/status",
      Buffer.from(
        JSON.stringify({
          vehicle_id: "npc_tank1",
          role_name: "npc_tank1",
          eo_task: { state: -1, progress: 0 },
          available: true,
        }),
      ),
      false,
      "2026-08-10T06:00:01.000Z",
    );

    expect(ingress.snapshot().payload.eoTask).toEqual({ state: -1, progress: 0 });
    expect(ingress.snapshot().payload.reconnaissance).toEqual({
      state: "unknown",
      motionStatus: "unknown",
    });
  });

  it("merges partial Device MCP reconnaissance observations without losing correlation", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", limits, npcTankMqttProfile());
    ingress.applyDeviceObservation(
      { payload: { reconnaissance: { id: "old-eo", state: 1, progress: 50 } } },
      ["payload"],
      "2026-08-10T06:00:00.000Z",
    );
    ingress.applyDeviceObservation(
      { payload: { reconnaissance: { state: -1, progress: 0 } } },
      ["payload"],
      "2026-08-10T06:00:01.000Z",
    );

    expect(ingress.snapshot().payload.reconnaissance).toEqual({
      id: "old-eo",
      state: -1,
      progress: 0,
      motionStatus: "unknown",
    });
  });
});

describe("NPC Tank navigation, EO, availability and safety", () => {
  it("selects only the captured navigation tool and fails closed when it is missing", () => {
    const contracts = mockNpcTankToolContracts("2026-07-23T00:00:00.000Z");
    expect(selectNpcNavigationTool(contracts).selected).toBe("npc_tank_path_follow_mission");
    const fallback = selectNpcNavigationTool(
      contracts.filter((contract) => contract.name !== "npc_tank_path_follow_mission"),
    );
    expect(fallback.selected).toBeUndefined();
    expect(fallback.fallbackValid).toBe(false);
    expect(fallback.reasonCode).toBe("NPC_TANK_NAVIGATION_TOOL_UNAVAILABLE");
  });

  it("advertises circular scan only when both captured recon schemas exist", () => {
    const contracts = mockNpcTankToolContracts();
    expect(npcCircularScanSupported(contracts)).toBe(true);
    expect(
      npcCircularScanSupported(
        contracts.filter((contract) => contract.name !== "npc_tank_area_recon_control"),
      ),
    ).toBe(false);
  });

  it("maps point navigation to the startup-selected tool", () => {
    const selection = selectNpcNavigationTool(mockNpcTankToolContracts());
    expect(
      npcStartDeviceCalls(
        "vehicle_navigate",
        {
          mission: {
            type: "point",
            target: { latitude: 30, longitude: 114 },
          },
          speedLimitKmh: 20,
          stopOnObstacle: true,
        },
        selection,
        true,
      )[0]?.name,
    ).toBe("npc_tank_path_follow_mission");
  });

  it("keeps active -1 in reconcile and uses NPC reason prefixes", () => {
    expect(mapVehicleTaskState(-1, true, "NPC_TANK")).toEqual({
      state: "RECONCILE",
      reasonCode: "UNCERTAIN_EXECUTION_STATE",
    });
    const arbiter = new TrackArbiter(true, "NPC_TANK");
    expect(arbiter.acquire("one", "vehicle_navigate").accepted).toBe(true);
    expect(arbiter.acquire("two", "vehicle_navigate").reasonCode).toBe(
      "NPC_TANK_CHASSIS_TRACK_BUSY",
    );
  });

  it("honors the navigation-with-recon policy in both directions", () => {
    const exclusive = new TrackArbiter(false, "NPC_TANK");
    expect(exclusive.acquire("recon", "vehicle_area_recon").accepted).toBe(true);
    expect(exclusive.acquire("nav", "vehicle_navigate").reasonCode).toBe("NPC_TANK_EO_TRACK_BUSY");
    exclusive.release("recon");
    expect(exclusive.acquire("nav", "vehicle_navigate").accepted).toBe(true);
    expect(exclusive.acquire("recon", "vehicle_area_recon").reasonCode).toBe(
      "NPC_TANK_CHASSIS_TRACK_BUSY",
    );

    const concurrent = new TrackArbiter(true, "NPC_TANK");
    expect(concurrent.acquire("recon", "vehicle_area_recon").accepted).toBe(true);
    expect(concurrent.acquire("nav", "vehicle_navigate").accepted).toBe(true);
  });

  it("returns NPC unknown availability when disconnected", () => {
    expect(
      checkVehicleAvailability({
        operationName: "vehicle_navigate",
        snapshot: createNpcTankSnapshot(),
        freshness: {
          chassis: 3000,
          mission: 3000,
          health: 5000,
          target: 3000,
          payload: 3000,
        },
        occupiedTracks: new Set(),
        requiredToolsPresent: true,
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        reasonPrefix: "NPC_TANK",
      }),
    ).toMatchObject({
      availability: "UNKNOWN",
      reasonCode: "NPC_TANK_MQTT_UNAVAILABLE",
    });
  });

  it("recursively strips verdict, referee and outcome truth fields", () => {
    const sanitized = sanitizeFireResult({
      accepted: true,
      verdict: { hit: true, destroyed: true },
      camp: 1,
      max_hp: 100,
      weapon: { damage: 50, hit_rate: 0.8, local: true },
      nested: { remainingHp: 0, referee: { alive: false }, local: true },
    });
    expect(JSON.stringify(sanitized.value)).toBe(
      '{"accepted":true,"weapon":{"local":true},"nested":{"local":true}}',
    );
    expect(sanitized.strippedFields).toBe(7);
  });
});
