import { describe, expect, it } from "vitest";
import { siteCatalogContract } from "../../scripts/ugv-zmq/site-catalog.js";
import {
  PLAN_ROUTE,
  SITE_PROFILE,
  PlanRouteInput,
} from "../../packages/vehicle-zmq-control/src/site-catalog.js";
import pinned from "../../contracts/ugv-zmq/provider-v1.1.0-readonly/catalog.json" with { type: "json" };
import consolePinned from "../../apps/ugv-control-console/shared/zmq-site-catalog.json" with { type: "json" };
import { nativeCatalogReason } from "../../apps/ugv-control-console/shared/zmq-native.js";
import { TaskEngine } from "../../packages/task-engine/src/engine.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import { siteManifest } from "../../packages/vehicle-zmq-control/src/site-catalog.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import type { ProviderManifest } from "../../packages/adapter-protocol/src/index.js";
import type { TaskRepository } from "../../packages/persistence-postgres/src/index.js";
import type { TaskAdapterGateway } from "../../packages/task-engine/src/diagnostic-gateway.js";

describe("site read-only catalog qualification boundary", () => {
  it("rejects an archived synchronous control before touching a gateway or repository", async () => {
    const raw = siteManifest(
      "provider",
      "resource",
      new MemoryProviderStore(),
    ) as unknown as ProviderManifest;
    raw.businessEventSources = [
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
    const manifest = new OperationRegistry().validate(raw),
      first = manifest.operations[0];
    if (!first) throw Error("FIXTURE_OPERATION_REQUIRED");
    const engine = new TaskEngine(
      manifest,
      new Map(),
      {} as TaskAdapterGateway,
      {} as TaskRepository,
    );
    const result = await engine.callOperation(
      { ...first, name: "vehicle_emergency_stop", execution: "SYNCHRONOUS" },
      {},
      { hash: "a".repeat(64), executionMode: "live", simulationId: null },
    );
    expect(result).toMatchObject({
      kind: "result",
      result: {
        isError: true,
        structuredContent: { reasonCode: "ZMQ_SITE_READONLY_CONTROL_DISABLED" },
      },
    });
  });
  it("pins all thirteen exact tools, profiles, schemas and native metadata", () => {
    const contract = siteCatalogContract();
    expect(contract.profile).toBe(SITE_PROFILE);
    expect(contract.tools).toHaveLength(13);
    expect(contract).toEqual(pinned);
    expect(pinned).toEqual(consolePinned);
    expect(nativeCatalogReason(contract.tools, "__RESOURCE_ID__")).toBeNull();
    const preview = contract.tools.find((t) => t.name === PLAN_ROUTE);
    expect(preview?._meta["io.sdar/tool-execution-semantics"]).toMatchObject({
      effect: "read_only",
      execution: "synchronous",
    });
    expect(preview?._meta["io.sdar/taskExecution"]).toMatchObject({
      supportsScheduling: false,
      supportsMaxElapsed: false,
      supportsCancellation: false,
    });
  });
  it("rejects absent, extra, mixed-version, resource and output drift", () => {
    const tools = siteCatalogContract().tools;
    const first = tools[0];
    if (!first) throw Error("FIXTURE_TOOL_REQUIRED");
    expect(nativeCatalogReason(tools.slice(1), "__RESOURCE_ID__")).toBe(
      "ZMQ_NATIVE_TOOL_SET_MISMATCH",
    );
    expect(
      nativeCatalogReason([...tools, { ...first, name: "unreviewed" }], "__RESOURCE_ID__"),
    ).not.toBeNull();
    const mixed = structuredClone(tools);
    delete mixed[0]?._meta["io.sdar/ugvZmq"];
    expect(nativeCatalogReason(mixed, "__RESOURCE_ID__")).toBe("ZMQ_NATIVE_CONTRACT_MISMATCH");
    expect(nativeCatalogReason(tools, "vehicle:other")).toBe("ZMQ_NATIVE_CONTRACT_MISMATCH");
    const drift = structuredClone(tools);
    if (drift[12]) drift[12].outputSchema = {};
    expect(nativeCatalogReason(drift, "__RESOURCE_ID__")).toBe("ZMQ_NATIVE_CONTRACT_MISMATCH");
  });
  it("validates WGS84 axes, limits and rejects address/altitude injection", () => {
    const args = {
      resourceId: "logical",
      start: { longitude: 106, latitude: 29 },
      waypoints: [{ longitude: 106.001, latitude: 29.001 }],
    };
    expect(PlanRouteInput.parse(args).density).toBe("adaptive");
    for (const input of [
      { ...args, endpoint: "http://other" },
      { ...args, start: { longitude: 29, latitude: 106 } },
      { ...args, waypoints: [] },
      { ...args, waypoints: Array.from({ length: 65 }, () => args.start) },
      { ...args, start: { ...args.start, altitude: 1 } },
    ])
      expect(() => PlanRouteInput.parse(input)).toThrow();
  });
});
