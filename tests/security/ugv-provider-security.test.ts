import { describe, expect, it } from "vitest";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";

describe("UGV security isolation", () => {
  it("rejects referee, world, NPC and Base64 topics before decoding payload", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 1024,
      maxDepth: 8,
      maxNodes: 128,
      maxStringBytes: 256,
    });
    for (const topic of [
      "/ugv/referee/status",
      "/ugv/status/#",
      "/ugv/target/base64",
      "/entity/state",
      "/referee/events",
      "/world/state",
      "/sim/fault",
      "/npc_tank1/status",
    ])
      expect(() => ingress.handle(topic, Buffer.from("{}"))).toThrow("UGV_MQTT_TOPIC_NOT_ALLOWED");
  });

  it("never permits a device tool outside the UGV allowlist", async () => {
    const device = new MockUgvDeviceMcpClient();
    await device.connect();
    await expect(device.call("referee_apply_damage" as never, { target: "ugv1" })).rejects.toThrow(
      "UGV_DEVICE_TOOL_UNAVAILABLE",
    );
  });

  it("rejects referee-shaped payloads from Business Events", async () => {
    const store = new MemoryProviderStore();
    const hub = new UgvBusinessEventHub(store);
    await expect(
      hub.publish({
        sourceId: "vehicle.execution",
        scope: "task",
        occurredAt: new Date().toISOString(),
        eventType: "vehicle.weapon.fire_completed",
        description: "local cycle",
        reasonCode: "UGV_FIRE_CYCLE_COMPLETED",
        externalExecutionId: "execution-1",
        severityHint: "info",
        rawPayload: { destroyed: true },
      }),
    ).rejects.toThrow("UGV_REFEREE_DATA_FORBIDDEN");
  });
});
