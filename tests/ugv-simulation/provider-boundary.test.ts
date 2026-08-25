import { readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { npcTankManifest } from "../../apps/npc-tank-provider-adapter/src/manifest.js";
import { normalizeUgvCapabilities } from "../../apps/ugv-provider-adapter/src/capabilities.js";
import { ugvManifest } from "../../apps/ugv-provider-adapter/src/manifest.js";
import {
  deduplicateTargets,
  normalizeDeviceTargets,
} from "../../apps/ugv-provider-adapter/src/targets.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import { mockUgvToolContracts } from "../../packages/vehicle-device-mcp-client/src/index.js";

describe("Goal 10 Provider boundary", () => {
  it("keeps the shared UGV surface stable while Goal 11 brings NPC to the same eleven operations", () => {
    const store = new MemoryProviderStore();
    const ugv = ugvManifest("isr.vehicle.ugv.ugv1", "1.0.0", store, "vehicle:ugv1", {
      contracts: mockUgvToolContracts("2026-08-20T00:00:00.000Z"),
      executionMode: "simulation",
    });
    const npc = npcTankManifest("isr.vehicle.npc-tank.npc-tank1", "1.0.0", store, false);
    expect((ugv.operations as { name: string }[]).map(({ name }) => name)).toEqual([
      "vehicle_get_state",
      "vehicle_get_capabilities",
      "vehicle_get_payload_status",
      "vehicle_get_targets",
      "vehicle_laser_range",
      "vehicle_navigate",
      "vehicle_area_recon",
      "vehicle_track_target",
      "vehicle_control_gimbal",
      "vehicle_fire_weapon",
      "vehicle_emergency_stop",
    ]);
    expect((npc.operations as { name: string }[]).map(({ name }) => name)).toEqual([
      "vehicle_get_state",
      "vehicle_get_capabilities",
      "vehicle_get_payload_status",
      "vehicle_get_targets",
      "vehicle_laser_range",
      "vehicle_navigate",
      "vehicle_area_recon",
      "vehicle_track_target",
      "vehicle_control_gimbal",
      "vehicle_fire_weapon",
      "vehicle_emergency_stop",
    ]);
  });

  it("derives capability support from reported contracts and never fabricates physical limits", () => {
    const contracts = mockUgvToolContracts("2026-08-10T00:00:00.000Z").map((entry) => {
      const withoutOutput = { ...entry };
      delete withoutOutput.outputSchema;
      return withoutOutput;
    });
    const normalized = normalizeUgvCapabilities(
      { error_code: 0, sensors: { gnss: true }, max_speed_kmh: 25 },
      contracts,
      "2026-08-10T00:00:00.000Z",
    );
    expect(normalized).toMatchObject({
      available: true,
      navigation: { point: true, route: true, distance: true, returnHome: true },
      payload: { reconnaissance: { area: true, circular: true }, gimbal: { supported: true } },
      deviceReported: { sensors: { gnss: true }, max_speed_kmh: 25 },
      provenance: {
        available: "device_reported",
        navigation: { point: "contract_inferred" },
        payload: { reconnaissance: { movingWhileRecon: "managed_configuration" } },
        engineeringProfile: "unverified",
      },
    });
    expect(JSON.stringify(normalized)).not.toContain("turningRadius");
    expect(JSON.stringify(normalized)).not.toContain("communicationRange");
    expect(
      normalizeUgvCapabilities({ available: false }, contracts, "2026-08-10T00:00:00.000Z")
        .available,
    ).toBe(false);
  });

  it("normalizes and deduplicates rich targets without exposing referee damage", () => {
    const device = normalizeDeviceTargets(
      [
        {
          capture_time_us: 1_786_320_000_000_000,
          target_id: 101,
          type: 3,
          position: { longitude: 114.1, latitude: 30.1, altitude: 5 },
          velocity: { vel_e: 1, vel_n: 2, vel_u: 0 },
          confidence: 0.9,
          damage: 100,
          role_name: "target-vehicle",
        },
      ],
      "2026-08-10T00:00:00.000Z",
    );
    const mqtt = {
      ...device[0],
      source: "mqtt_area_recon",
      confidence: 0.95,
    } as Record<string, unknown>;
    const merged = deduplicateTargets(device, [mqtt]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      targetId: "101",
      source: "mqtt_area_recon",
      confidence: 0.95,
    });
    expect(JSON.stringify(merged)).not.toContain("damage");
  });

  it("uses the shared qualification matrix for read-only preflight evidence", () => {
    const source = readFileSync("scripts/ugv-simulation/preflight.mjs", "utf8");
    expect(source).toContain("UgvOperationQualificationService");
    expect(source).toContain("operationQualifications");
    expect(source).toContain("requiredOperationFailures");
    expect(source).not.toContain("ESSENTIAL_DEVICE_READ_TOOLS");
    expect(source).not.toContain("KNOWN_SIMULATOR_TOOLS =");
  });

  it("binds preflight to the locked MQTT profile and emits explicit zero-side-effect simulation evidence", () => {
    const source = readFileSync("scripts/ugv-simulation/preflight.mjs", "utf8");
    expect(source).toContain("UGV_MQTT_SUBSCRIPTIONS");
    expect(source).not.toContain("const PROTOCOL_TOPICS");
    expect(source).toContain('evidenceClass: "external_simulation"');
    expect(source).toContain("productionEligible: false");
    expect(source).toContain("physicalVehicleQualified: false");
    expect(source).toContain("toolsCallCount: 0");
    expect(source).toContain("mqttPublishCount: 0");
    expect(source).toContain("controlInvocationCount: 0");
    expect(source).toContain('authoritativeStateFreshness: "UNVERIFIED_PAYLOAD_NOT_RETAINED"');
    expect(source).toContain("report.generatedAt = report.completedAt");
    expect(source).not.toContain('endsWith("/coverage")');
    expect(source).not.toContain(".callTool(");
    expect(source).not.toContain(".publish(");
  });

  it("writes classified zero-side-effect evidence when configuration fails before network access", () => {
    const output = `/tmp/ugv-agent-profile-preflight-${process.pid}.json`;
    const environment = { ...process.env };
    for (const name of [
      "UGV_SIM_DEVICE_MCP_URL",
      "UGV_SIM_MQTT_URL",
      "UGV_ADAPTER_DB_PASSWORD",
      "UGV_RUNTIME_DB_PASSWORD",
    ])
      Reflect.deleteProperty(environment, name);
    rmSync(output, { force: true });
    const execution = spawnSync(
      process.execPath,
      ["scripts/ugv-simulation/preflight.mjs", "--output", output],
      { cwd: process.cwd(), env: environment, encoding: "utf8" },
    );
    expect(execution.status).toBe(2);
    const report = JSON.parse(readFileSync(output, "utf8")) as Record<string, unknown>;
    expect(report).toMatchObject({
      schemaVersion: 1,
      evidenceClass: "external_simulation",
      productionEligible: false,
      physicalVehicleQualified: false,
      status: "BLOCKED_EXTERNAL_ENV",
      exitCode: 2,
      safety: {
        toolsCallCount: 0,
        mqttPublishCount: 0,
        controlInvocationCount: 0,
      },
    });
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    rmSync(output, { force: true });
  });
});
