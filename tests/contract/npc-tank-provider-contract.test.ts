import { describe, expect, it } from "vitest";
import { npcTankManifest } from "../../apps/npc-tank-provider-adapter/src/manifest.js";
import { npcTankResource } from "../../apps/npc-tank-provider-adapter/src/server.js";
import {
  MemoryProviderStore,
  businessEventSourceCapabilities,
} from "../../packages/provider-adapter-kit/src/index.js";
import {
  mockNpcTankToolContracts,
  NPC_OPERATION_REQUIRED_TOOLS,
  NPC_TANK_DEVICE_TOOL_ALLOWLIST,
} from "../../packages/vehicle-device-mcp-client/src/index.js";
import {
  createNpcTankSnapshot,
  vehicleEvidence,
} from "../../packages/vehicle-provider-core/src/index.js";

describe("NPC Tank manifest, resource dependencies and event contract", () => {
  it("publishes the fixed provider identity and exactly nine operations", () => {
    const manifest = npcTankManifest(
      "isr.vehicle.npc-tank.npc-tank1",
      "0.1.0",
      new MemoryProviderStore(),
      false,
    );
    expect(manifest).toMatchObject({
      adapterProtocolVersion: "1.0",
      providerId: "isr.vehicle.npc-tank.npc-tank1",
      providerType: "isr.vehicle.npc_tank",
    });
    expect((manifest.operations as { name: string }[]).map((value) => value.name)).toEqual([
      "vehicle_get_state",
      "vehicle_get_payload_status",
      "vehicle_get_targets",
      "vehicle_laser_range",
      "vehicle_navigate",
      "vehicle_area_recon",
      "vehicle_track_target",
      "vehicle_fire_weapon",
      "vehicle_emergency_stop",
    ]);
  });

  it("conditionally includes circular scan in the area-recon schema", () => {
    const store = new MemoryProviderStore();
    const without = npcTankManifest("p", "0.1.0", store, false);
    const withCircular = npcTankManifest("p", "0.1.0", store, true);
    const modes = (manifest: Record<string, unknown>) => {
      const operation = (manifest.operations as { name: string; inputSchema: unknown }[]).find(
        (candidate) => candidate.name === "vehicle_area_recon",
      );
      return JSON.stringify(operation?.inputSchema);
    };
    expect(modes(without)).not.toContain("circular");
    expect(modes(withCircular)).toContain("circular");
  });

  it("exposes one vehicle resource with internal tracks and no referee truth", () => {
    const resource = npcTankResource(createNpcTankSnapshot(false), {
      circularScanSupported: () => false,
    } as never);
    expect(resource).toMatchObject({
      resourceId: "vehicle:npc_tank1",
      resourceType: "isr.vehicle.npc_tank",
      displayName: "NPC Tank 1",
      enabled: true,
    });
    const encoded = JSON.stringify(resource);
    expect(encoded).toContain("supportsCircularEoScan");
    expect(encoded).toContain("refereeDataAvailable");
    expect(encoded).not.toMatch(/remainingHp|globalTruthAvailable[^}]*true/);
  });

  it("captures only explicit candidate tools with valid schemas", () => {
    const contracts = mockNpcTankToolContracts("2026-07-23T00:00:00.000Z");
    expect(contracts.map((contract) => contract.name)).toEqual(NPC_TANK_DEVICE_TOOL_ALLOWLIST);
    expect(contracts.every((contract) => contract.inputSchema.type === "object")).toBe(true);
    expect(
      Object.values(NPC_OPERATION_REQUIRED_TOOLS)
        .flat()
        .every((tool) => NPC_TANK_DEVICE_TOOL_ALLOWLIST.includes(tool)),
    ).toBe(true);
  });

  it("uses the three shared source semantics and NPC evidence subject", () => {
    expect(
      businessEventSourceCapabilities().map((source) => [
        source.sourceId,
        source.deliverySemantics,
      ]),
    ).toEqual([
      ["vehicle.execution", "durable_at_least_once"],
      ["vehicle.health", "durable_at_least_once"],
      ["vehicle.target", "best_effort_live"],
    ]);
    expect(
      vehicleEvidence(
        "vehicle.state.observation",
        "2026-07-23T00:00:00.000Z",
        "/revision",
        "resource:vehicle:npc_tank1",
        ["isr.vehicle.npc-tank.npc-tank1", "npc-tank-adapter"],
      ),
    ).toMatchObject({
      subjectRef: "resource:vehicle:npc_tank1",
      producer: ["isr.vehicle.npc-tank.npc-tank1", "npc-tank-adapter"],
    });
  });
});
