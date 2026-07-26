import { describe, expect, it } from "vitest";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import { MockNpcTankDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import {
  NPC_TANK_MQTT_TOPICS,
  npcTankMqttProfile,
  VehicleMqttIngress,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { VehicleBusinessEventHub } from "../../packages/vehicle-provider-core/src/index.js";

describe("NPC Tank security and provider isolation", () => {
  it("rejects referee, UGV, world and wildcard topics before payload decoding", () => {
    const ingress = new VehicleMqttIngress(
      "direct_domain_json",
      { maxPayloadBytes: 1024, maxDepth: 8, maxNodes: 128, maxStringBytes: 256 },
      npcTankMqttProfile(),
    );
    expect(NPC_TANK_MQTT_TOPICS).toHaveLength(12);
    for (const topic of [
      "/npc_tank1/referee/status",
      "/npc_tank1/target/base64",
      "/entity/state",
      "/referee/events",
      "/world/state",
      "/sim/fault",
      "/ugv/status",
      "/npc_tank1/#",
      "#",
    ])
      expect(() => ingress.handle(topic, Buffer.from("{}"))).toThrow(
        "NPC_TANK_MQTT_TOPIC_NOT_ALLOWED",
      );
  });

  it("rejects every tool outside the NPC allowlist", async () => {
    const device = new MockNpcTankDeviceMcpClient();
    await device.connect();
    await expect(
      device.call("ugv_attack_target" as never, { target_id: "target-1" }),
    ).rejects.toThrow("NPC_TANK_DEVICE_TOOL_UNAVAILABLE");
  });

  it("rejects referee-shaped Business Event payloads", async () => {
    const hub = new VehicleBusinessEventHub(new MemoryProviderStore(), {
      reasonPrefix: "NPC_TANK",
      resourceId: "vehicle:npc_tank1",
    });
    await expect(
      hub.publish({
        sourceId: "vehicle.execution",
        scope: "task",
        occurredAt: new Date().toISOString(),
        eventType: "vehicle.weapon.fire_completed",
        description: "local cycle",
        reasonCode: "NPC_TANK_FIRE_CYCLE_COMPLETED",
        externalExecutionId: "execution-1",
        resourceRef: "vehicle:npc_tank1",
        severityHint: "info",
        rawPayload: { verdict: { destroyed: true } },
      }),
    ).rejects.toThrow();
  });

  it("keeps UGV and NPC execution stores physically independent", async () => {
    const ugvStore = new MemoryProviderStore();
    const npcStore = new MemoryProviderStore();
    const now = new Date().toISOString();
    await ugvStore.putExecution({
      taskId: "shared-task",
      externalExecutionId: "ugv:execution",
      operationName: "vehicle_navigate",
      argumentHash: "a".repeat(64),
      resourceId: "vehicle:ugv1",
      tracks: ["chassis"],
      arguments: {},
      executionContext: {
        authorizationContextHash: "b".repeat(64),
        executionMode: "SIMULATION",
        simulationId: "sim",
        correlationId: "correlation",
      },
      downstreamMissionIds: [],
      state: "RUNNING",
      revision: 1,
      reasonCode: "UGV_DEVICE_TASK_RUNNING",
      createdAt: now,
      updatedAt: now,
      evidence: [],
    });
    expect(await npcStore.getExecution("shared-task")).toBeUndefined();
  });
});
