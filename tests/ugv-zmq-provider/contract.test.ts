import { describe, it, expect } from "vitest";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import {
  zmqProviderManifest,
  zmqTool,
  ZMQ_PROVIDER_TOOLS,
  zmqOperation,
} from "../../packages/vehicle-zmq-control/src/catalog.js";
import { zmqConsoleTool } from "../../packages/vehicle-zmq-contract/src/console-contract.js";
import { nativeTiming } from "../../apps/ugv-zmq-provider-adapter/src/runtime.js";
import pinned from "../../contracts/ugv-zmq/provider-v1/catalog.json" with { type: "json" };
import consolePinned from "../../apps/ugv-control-console/shared/zmq-native-catalog.json" with { type: "json" };
import { nativeCatalogReason } from "../../apps/ugv-control-console/shared/zmq-native.js";
import {
  protoStructToJson,
  jsonToProtoStruct,
  type ProviderManifest,
} from "../../packages/adapter-protocol/src/index.js";
function present<T>(value: T | undefined): T {
  if (value === undefined) throw Error("FIXTURE_VALUE_REQUIRED");
  return value;
}
const manifest = () => {
  const m = zmqProviderManifest(
    "isr.vehicle.ugv.sim",
    "vehicle:sim",
    new MemoryProviderStore(),
  ) as unknown as ProviderManifest;
  m.businessEventSources = [
    {
      sourceId: "vehicle.business",
      sourceStreamId: "12345678-1234-1234-1234-123456789abc",
      deliverySemantics: "durable_at_least_once",
      replaySupported: true,
      sourceRetentionMs: "604800000",
      maxEventBytes: "262144",
      maxPayloadDepth: 32,
      maxPayloadNodes: 10000,
      maxPayloadStringBytes: "65536",
    },
  ];
  return m;
};
describe("formal ZMQ catalog", () => {
  it("pins every schema and policy identically in the Provider and console", () => {
    const m = manifest();
    for (const operation of m.operations) {
      const schema = protoStructToJson(operation.inputSchema);
      present((schema.properties as Record<string, { const: string }>).resourceId).const =
        "__RESOURCE_ID__";
      operation.inputSchema = jsonToProtoStruct(schema);
    }
    const current = new OperationRegistry().validate(m).operations.map((o) => o.tool);
    expect(pinned.tools).toEqual(current);
    expect(consolePinned).toEqual(pinned);
    expect(nativeCatalogReason(current, "__RESOURCE_ID__")).toBeNull();
    expect(nativeCatalogReason(current.slice(1), "__RESOURCE_ID__")).toBe(
      "ZMQ_NATIVE_TOOL_SET_MISMATCH",
    );
    const drift = structuredClone(current);
    present(drift.find((t) => t.name === "vehicle_zmq_inspect_area")).outputSchema = {};
    expect(nativeCatalogReason(drift, "__RESOURCE_ID__")).toBe("ZMQ_NATIVE_CONTRACT_MISMATCH");
  });
  it("publishes only the exact native tool set, profiles and console candidate contracts", () => {
    const m = manifest();
    const validated = new OperationRegistry().validate(m);
    expect(validated.operations).toHaveLength(12);
    expect(validated.operations.map((o) => o.name)).toEqual(ZMQ_PROVIDER_TOOLS);
    for (const name of [
      "vehicle_zmq_inspect_area",
      "simulation_apply_effect",
      "vehicle_get_inspection_result",
      "simulation_get_effect_result",
    ]) {
      const c = zmqConsoleTool(name, "vehicle:sim"),
        t = zmqTool(name, "vehicle:sim");
      expect(t.inputSchema).toEqual(c.inputSchema);
      expect(t._meta["io.sdar/ugvZmq"]).toEqual(c._meta["io.sdar/ugvZmq"]);
    }
    expect(() =>
      new OperationRegistry().validate({ ...m, operations: m.operations.slice(1) }),
    ).toThrow("ZMQ_CATALOG_TOOL_SET_MISMATCH");
    expect(() =>
      new OperationRegistry().validate({
        ...m,
        operations: [...m.operations, { ...present(m.operations[0]), name: "vehicle_fire_weapon" }],
      }),
    ).toThrow("ZMQ_CATALOG_TOOL_SET_MISMATCH");
    const drift = structuredClone(m);
    present(drift.operations[0]).capabilities.cancel = true;
    expect(() => new OperationRegistry().validate(drift)).toThrow("ZMQ_CATALOG_CONTRACT_MISMATCH");
    const mixed = structuredClone(m);
    mixed.operations[1] = present(
      (
        zmqProviderManifest(
          "isr.vehicle.ugv.sim",
          "vehicle:other",
          new MemoryProviderStore(),
        ) as unknown as ProviderManifest
      ).operations[1],
    );
    expect(() => new OperationRegistry().validate(mixed)).toThrow("ZMQ_CATALOG_RESOURCE_INVALID");
    expect(protoStructToJson(present(m.operations[0]).inputSchema)).toHaveProperty("properties");
  });
  it("keeps a hard anchored deadline, rejects excess and expired timing", () => {
    const at = Date.parse("2026-10-24T00:00:00Z");
    expect(
      nativeTiming(
        {
          start: {
            mode: "SCHEDULED",
            scheduledAt: { seconds: String(at / 1000) },
            startToleranceMs: "1000",
          },
          maxElapsedMs: "300000",
        },
        at + 500,
      ),
    ).toEqual({
      startAt: new Date(at).toISOString(),
      startToleranceMs: 1000,
      maxElapsedMs: 300000,
      parentDeadlineAt: new Date(at + 300000).toISOString(),
    });
    expect(() => nativeTiming({ maxElapsedMs: 300001 }, at)).toThrow();
    expect(() => nativeTiming({ start: { mode: "SCHEDULED" } }, at)).toThrow(
      "ZMQ_SCHEDULED_TIME_REQUIRED",
    );
    expect(() =>
      nativeTiming(
        {
          start: {
            mode: "SCHEDULED",
            scheduledAt: { seconds: String(at / 1000) },
            startToleranceMs: 1000,
          },
        },
        at + 1001,
      ),
    ).toThrow("ZMQ_START_OR_DEADLINE_EXPIRED");
  });
  it("rejects unsupported native/legacy operation substitution", () => {
    expect(() =>
      zmqOperation("vehicle_zmq_navigate", {
        resourceId: "vehicle:sim",
        operation: { name: "camera.zoom", params: { zoom_ratio: 2, zoom_timeout_ms: 1000 } },
      }),
    ).toThrow("ZMQ_OPERATION_BINDING_INVALID");
    expect(() => zmqOperation("vehicle_fire_weapon", {})).toThrow();
  });
});
