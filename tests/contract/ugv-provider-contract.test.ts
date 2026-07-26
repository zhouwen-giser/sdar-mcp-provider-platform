import { describe, expect, it } from "vitest";
import { ugvManifest } from "../../apps/ugv-provider-adapter/src/manifest.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import {
  mockUgvToolContracts,
  OPERATION_REQUIRED_TOOLS,
  UGV_DEVICE_TOOL_ALLOWLIST,
} from "../../packages/vehicle-device-mcp-client/src/index.js";

describe("UGV Provider operation and source contract", () => {
  it("publishes exactly the nine frozen UGV operations", () => {
    const manifest = ugvManifest("isr.vehicle.ugv.ugv1", "1.0.0", new MemoryProviderStore());
    expect((manifest.operations as { name: string }[]).map((operation) => operation.name)).toEqual([
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
    expect(manifest).toMatchObject({
      adapterProtocolVersion: "1.0",
      providerId: "isr.vehicle.ugv.ugv1",
      providerType: "isr.vehicle.ugv",
      inventoryMode: "RUNTIME_VISIBLE",
    });
  });

  it("freezes fire confirmation and emergency-stop capability flags", () => {
    const operations = ugvManifest("isr.vehicle.ugv.ugv1", "1.0.0", new MemoryProviderStore())
      .operations as { name: string; capabilities: Record<string, boolean> }[];
    expect(operations.find((x) => x.name === "vehicle_fire_weapon")?.capabilities).toMatchObject({
      cancel: true,
      pauseResume: false,
      inputRequired: true,
      idempotency: true,
    });
    expect(operations.find((x) => x.name === "vehicle_emergency_stop")?.capabilities).toMatchObject(
      {
        cancel: false,
        pauseResume: false,
        inputRequired: false,
      },
    );
  });

  it("declares two durable sources and one best-effort target source", () => {
    const sources = new MemoryProviderStore().businessEventSources();
    expect(
      sources.map((source) => [source.sourceId, source.deliverySemantics, source.replaySupported]),
    ).toEqual([
      ["vehicle.execution", "durable_at_least_once", true],
      ["vehicle.health", "durable_at_least_once", true],
      ["vehicle.target", "best_effort_live", false],
    ]);
  });

  it("uses only captured mock fixture tools from the explicit allowlist", () => {
    const contracts = mockUgvToolContracts("2026-07-23T00:00:00.000Z");
    expect(contracts.map((tool) => tool.name)).toEqual(UGV_DEVICE_TOOL_ALLOWLIST);
    expect(
      contracts.every(
        (tool) => tool.inputSchema.type === "object" && tool.schemaHash.length === 64,
      ),
    ).toBe(true);
    expect(
      Object.values(OPERATION_REQUIRED_TOOLS)
        .flat()
        .every((tool) => UGV_DEVICE_TOOL_ALLOWLIST.includes(tool)),
    ).toBe(true);
  });
});
