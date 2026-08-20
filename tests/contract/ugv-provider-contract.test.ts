import { describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { ugvManifest } from "../../apps/ugv-provider-adapter/src/manifest.js";
import {
  protoStructToJson,
  type ProviderManifest,
} from "../../packages/adapter-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import {
  mockUgvToolContracts,
  OPERATION_REQUIRED_TOOLS,
  UGV_DEVICE_TOOL_ALLOWLIST,
} from "../../packages/vehicle-device-mcp-client/src/index.js";
import {
  VEHICLE_EVIDENCE_V1_SCHEMA,
  vehicleEvidence,
} from "../../packages/vehicle-provider-core/src/index.js";

describe("UGV Provider operation and source contract", () => {
  it("publishes the eleven Goal 10 UGV operations without changing the transport profile", () => {
    const manifest = testManifest();
    expect((manifest.operations as { name: string }[]).map((operation) => operation.name)).toEqual([
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
    expect(manifest).toMatchObject({
      adapterProtocolVersion: "1.0",
      providerId: "isr.vehicle.ugv.ugv1",
      providerType: "isr.vehicle.ugv",
      inventoryMode: "RUNTIME_VISIBLE",
    });
  });

  it("freezes fire confirmation and emergency-stop capability flags", () => {
    const operations = testManifest().operations as {
      name: string;
      capabilities: Record<string, boolean>;
    }[];
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

  it("exposes a finite gimbal task and makes recon area conditional for circular scan", () => {
    const operations = testManifest().operations as {
      name: string;
      execution: string;
      inputSchema: unknown;
      outputSchema: unknown;
      capabilities: { cancel: boolean };
    }[];
    const capabilities = operations.find(
      (operation) => operation.name === "vehicle_get_capabilities",
    );
    const gimbal = operations.find((operation) => operation.name === "vehicle_control_gimbal");
    const recon = operations.find((operation) => operation.name === "vehicle_area_recon");
    const fire = operations.find((operation) => operation.name === "vehicle_fire_weapon");
    const track = operations.find((operation) => operation.name === "vehicle_track_target");
    expect(capabilities?.execution).toBe("SYNCHRONOUS");
    expect(gimbal?.execution).toBe("TASK_REQUIRED");
    expect(JSON.stringify(protoStructToJson(gimbal?.inputSchema))).not.toContain("velocity");
    const reconSchema = protoStructToJson(recon?.inputSchema);
    const reconOutput = protoStructToJson(recon?.outputSchema);
    const fireOutput = protoStructToJson(fire?.outputSchema);
    expect(reconSchema.required).not.toContain("area");
    expect(reconSchema.allOf).toBeDefined();
    expect(reconOutput).toHaveProperty("properties.coverability");
    expect(reconOutput).toHaveProperty("properties.outOfRange");
    expect(JSON.stringify(fireOutput)).toContain("fire_command_rejected");
    expect(fire?.capabilities.cancel).toBe(true);
    const trackSchema = protoStructToJson(track?.inputSchema);
    expect(trackSchema).toMatchObject({
      required: ["resourceId", "targetId"],
      additionalProperties: false,
    });
    expect(Object.keys(trackSchema.properties as Record<string, unknown>)).toEqual([
      "resourceId",
      "targetId",
    ]);
    expect(JSON.stringify(trackSchema)).not.toMatch(/maintainLock|timeoutMs|desiredZoom/);
  });

  it("passes the Runtime's strict operation-manifest validation", () => {
    const manifest = testManifest();
    expect(() =>
      new OperationRegistry().validate(manifest as unknown as ProviderManifest),
    ).not.toThrow();
  });

  it("accepts authoritative navigation evidence in the declared terminal output", () => {
    const manifest = new OperationRegistry().validate(
      testManifest() as unknown as ProviderManifest,
    );
    const navigate = manifest.operations.find(({ name }) => name === "vehicle_navigate");
    expect(navigate).toBeDefined();
    expect(() =>
      navigate?.validateOutput({
        resourceId: "vehicle:ugv1",
        status: "completed",
        observedAt: "2026-08-20T12:31:18.576Z",
        positionAuthority: {
          field: "chassis.position.local",
          topic: "/ugv/nav_state",
          observedAt: "2026-08-20T12:31:18.576Z",
          timeAuthority: "source",
          cursor: "oc1.test",
        },
        displacementUnavailableReason: "POSITION_AUTHORITY_MISMATCH",
      }),
    ).not.toThrow();
  });

  it("publishes versioned closed Vehicle DTO schemas", () => {
    const operations = testManifest().operations as { name: string; outputSchema: unknown }[];
    const stateSchema = protoStructToJson(
      operations.find(({ name }) => name === "vehicle_get_state")?.outputSchema,
    );
    expect(stateSchema).toMatchObject({ title: "VehicleStateV1", additionalProperties: false });
    expect(JSON.stringify(stateSchema)).not.toContain("entityId");
    expect(
      protoStructToJson(
        operations.find(({ name }) => name === "vehicle_get_capabilities")?.outputSchema,
      ),
    ).toMatchObject({ title: "VehicleCapabilitiesV1", additionalProperties: false });
    expect(
      protoStructToJson(operations.find(({ name }) => name === "vehicle_navigate")?.outputSchema),
    ).toMatchObject({ title: "VehicleTaskResultV1", additionalProperties: false });
    expect(VEHICLE_EVIDENCE_V1_SCHEMA).toMatchObject({
      title: "VehicleEvidenceV1",
      additionalProperties: false,
    });
    const validateEvidence = new Ajv2020({ strict: true, validateFormats: false }).compile(
      VEHICLE_EVIDENCE_V1_SCHEMA,
    );
    expect(
      validateEvidence(
        vehicleEvidence(
          "vehicle.mission.state",
          "2026-08-20T00:00:00.000Z",
          "/status",
          "execution:vehicle:ugv1:chassis:test",
          ["isr.vehicle.ugv.ugv1", "ugv-adapter"],
        ),
      ),
    ).toBe(true);
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

function testManifest(): Record<string, unknown> {
  return ugvManifest("isr.vehicle.ugv.ugv1", "1.0.0", new MemoryProviderStore(), "vehicle:ugv1", {
    contracts: mockUgvToolContracts("2026-08-20T00:00:00.000Z"),
    executionMode: "simulation",
  });
}
