import * as grpc from "@grpc/grpc-js";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GrpcAdapterGateway,
  protoStructToJson,
} from "../../packages/adapter-protocol/src/index.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/memory-store.js";
import {
  VehicleProviderGrpcServer,
  type VehicleAdapterRuntime,
} from "../../packages/provider-adapter-kit/src/vehicle-grpc-server.js";
import {
  createUgvSnapshot,
  VehicleBusinessEventHub,
} from "../../packages/vehicle-provider-core/src/index.js";

let server: VehicleProviderGrpcServer | undefined;
let gateway: GrpcAdapterGateway | undefined;

afterEach(async () => {
  gateway?.close();
  gateway = undefined;
  await server?.close();
  server = undefined;
});

async function setup(enabled: boolean, responseBytes = Uint8Array.from([1, 2, 3])) {
  const calls: unknown[] = [];
  const store = new MemoryProviderStore();
  const legacyUpdate = vi.fn<VehicleAdapterRuntime["updateFire"]>(async () => ({
    accepted: true,
    reasonCode: "LEGACY",
    commandSequence: "7",
  }));
  const runtime: VehicleAdapterRuntime = {
    events: new EventEmitter(),
    snapshot: () => createUgvSnapshot(),
    availability: () => {
      throw new Error("UNUSED");
    },
    start: async () => {
      throw new Error("DEVICE_START_MUST_NOT_RUN");
    },
    get: async () => undefined,
    reconcile: async () => ({}),
    command: async () => ({}),
    updateFire: legacyUpdate,
    executionSnapshot: () => ({}),
    ...(enabled
      ? ({
          getBusinessContext: async (identity, maxPageBytes, pageCursor) => {
            calls.push(["context", identity, maxPageBytes, pageCursor]);
            return {
              contextRevision: 2,
              context: { identity: { taskId: identity.taskId }, contextRevision: 2 },
              objects: [],
              objectDescriptors: [],
            };
          },
          getBusinessSnapshotPart: async (identity, selector) => {
            calls.push(["snapshot-part", identity, selector]);
            const jsonBytes = Buffer.from(
              JSON.stringify({ ref: selector.objectRef?.id ?? "context" }),
            );
            return {
              jsonBytes: jsonBytes.subarray(selector.offset, selector.offset + selector.maxBytes),
              totalBytes: jsonBytes.length,
              sha256: "c".repeat(64),
              ...(selector.offset + selector.maxBytes < jsonBytes.length
                ? { nextOffset: selector.offset + selector.maxBytes }
                : {}),
            };
          },
          getBusinessArtifact: async (
            identity,
            artifactId,
            revision,
            representationName,
            includeContent,
          ) => {
            calls.push([
              "artifact",
              identity,
              artifactId,
              revision,
              representationName,
              includeContent,
            ]);
            return {
              artifact: { artifactId, revision: revision ?? 3 },
              contentBytes: responseBytes,
              mediaType: "application/octet-stream",
              sha256: "a".repeat(64),
            };
          },
          updateTaskBusinessInput: async (identity, command) => {
            calls.push(["input", identity, command]);
            return {
              accepted: true,
              reasonCode: "ACCEPTED",
              commandSequence: identity.commandSequence,
              identity,
            };
          },
          applyIntervention: async (identity, command) => {
            calls.push(["intervention", identity, command]);
            return {
              accepted: true,
              reasonCode: "ACCEPTED",
              commandSequence: identity.commandSequence,
              identity,
            };
          },
        } satisfies Partial<VehicleAdapterRuntime>)
      : {}),
  };
  server = new VehicleProviderGrpcServer(
    {
      host: "127.0.0.1",
      port: 0,
      tlsMode: "disabled",
      internalErrorCode: "ADAPTER_INTERNAL",
      manifest: () => ({}),
      resource: () => ({}),
    },
    runtime,
    store,
    new VehicleBusinessEventHub(store, { reasonPrefix: "UGV", resourceId: "vehicle:ugv1" }),
  );
  const port = await server.start();
  gateway = new GrpcAdapterGateway({
    endpoint: `127.0.0.1:${String(port)}`,
    providerId: "provider-a",
  });
  return { gateway, calls, legacyUpdate, runtime };
}

const options = {
  authorizationContextHash: "a".repeat(64),
  executionMode: "simulation" as const,
  simulationId: "scene-a",
  externalExecutionId: "execution-a",
};
const commandIdentity = {
  taskId: "task-a",
  operationName: "vehicle_navigate",
  argumentHash: "b".repeat(64),
  commandSequence: 7,
};

describe("task-business Adapter gRPC wire", () => {
  it("round-trips bounded Context and exact object JSON chunks through the private RPC", async () => {
    const { gateway: client, calls } = await setup(true);
    const contextPart = await client.getBusinessSnapshotPart(
      "task-a",
      "execution-a",
      { contextRevision: 2, offset: 0, maxBytes: 8 },
      options,
    );
    expect(Buffer.from(contextPart.jsonBytes).toString("utf8")).toBe('{"ref":"');
    expect(contextPart.nextOffset).toBe("8");
    const objectPart = await client.getBusinessSnapshotPart(
      "task-a",
      "execution-a",
      {
        contextRevision: 2,
        objectRef: { kind: "action", id: "action-a", revision: 3 },
        offset: 0,
        maxBytes: 1_024,
      },
      options,
    );
    expect(JSON.parse(Buffer.from(objectPart.jsonBytes).toString("utf8"))).toEqual({
      ref: "action-a",
    });
    expect(calls).toMatchObject([
      ["snapshot-part", expect.any(Object), { contextRevision: 2, offset: 0, maxBytes: 8 }],
      [
        "snapshot-part",
        expect.any(Object),
        {
          contextRevision: 2,
          objectRef: { kind: "action", id: "action-a", revision: 3 },
          offset: 0,
          maxBytes: 1_024,
        },
      ],
    ]);
  });

  it("round-trips reads, bytes and both command kinds without starting a device task", async () => {
    const { gateway: client, calls, legacyUpdate } = await setup(true);
    const page = await client.getBusinessContext(
      "task-a",
      "execution-a",
      8_192,
      "cursor-a",
      options,
    );
    expect(page).toMatchObject({ contextRevision: 2, context: { identity: { taskId: "task-a" } } });
    const exact = await client.getBusinessArtifact(
      "task-a",
      "execution-a",
      "route-a",
      2,
      "download",
      true,
      options,
    );
    expect(exact.artifact).toMatchObject({ artifactId: "route-a", revision: 2 });
    expect(Buffer.from(exact.contentBytes ?? []).equals(Buffer.from([1, 2, 3]))).toBe(true);
    const latest = await client.getBusinessArtifact(
      "task-a",
      "execution-a",
      "route-a",
      undefined,
      "",
      false,
      options,
    );
    expect(latest.artifact).toMatchObject({ revision: 3 });
    expect(latest.contentBytes).toBeUndefined();
    const input = {
      schemaVersion: "sdar.task-business-input-command/1.0-rc2",
      commandId: "input-a",
      result: { action: "accept", value: { approved: true } },
    };
    expect((await client.updateTaskBusinessInput(commandIdentity, input, options)).accepted).toBe(
      true,
    );
    const intervention = {
      schemaVersion: "sdar.task-business-intervention-command/1.0-rc2",
      commandId: "intervention-a",
      input: { destination: [116, 39] },
    };
    expect((await client.applyIntervention(commandIdentity, intervention, options)).accepted).toBe(
      true,
    );
    expect(calls).toMatchObject([
      [
        "context",
        {
          taskId: "task-a",
          externalExecutionId: "execution-a",
          executionContext: {
            authorizationContextHash: options.authorizationContextHash,
            simulationId: "scene-a",
          },
        },
        8_192,
        "cursor-a",
      ],
      ["artifact", expect.any(Object), "route-a", 2, "download", true],
      ["artifact", expect.any(Object), "route-a", undefined, "", false],
      ["input", expect.objectContaining({ commandSequence: "7" }), input],
      ["intervention", expect.objectContaining({ commandSequence: "7" }), intervention],
    ]);
    expect(legacyUpdate).not.toHaveBeenCalled();
  });

  it("returns UNIMPLEMENTED for an unadvertised business method", async () => {
    const { gateway: client } = await setup(false);
    await expect(
      client.getBusinessContext("task-a", "execution-a", 8_192, "", options),
    ).rejects.toMatchObject({
      code: grpc.status.UNIMPLEMENTED,
      details: "BUSINESS_METHOD_NOT_ENABLED",
    });
    await expect(
      client.getBusinessSnapshotPart(
        "task-a",
        "execution-a",
        { contextRevision: 2, offset: 0, maxBytes: 1_024 },
        options,
      ),
    ).rejects.toMatchObject({ code: grpc.status.UNIMPLEMENTED });
    await expect(client.applyIntervention(commandIdentity, {}, options)).rejects.toMatchObject({
      code: grpc.status.UNIMPLEMENTED,
    });
  });

  it("preserves the existing MCP input response path on UpdateExecution", async () => {
    const { gateway: client, legacyUpdate } = await setup(true);
    await client.updateMcpTaskExecution(
      commandIdentity,
      [{ key: "decision-a", result: { action: "accept", content: { approved: true } } }],
      options,
    );
    expect(legacyUpdate).toHaveBeenCalledOnce();
    expect(legacyUpdate.mock.calls[0]?.[1]).toMatchObject([{ key: "decision-a" }]);
  });

  it("routes both legacy and MCP replies to an operation-aware Runtime handler", async () => {
    const { gateway: client, runtime, legacyUpdate } = await setup(true);
    const routed = vi.fn<NonNullable<VehicleAdapterRuntime["updateInput"]>>(async () => ({
      accepted: false,
      reasonCode: "HANDLER_NOT_AVAILABLE",
    }));
    runtime.updateInput = routed;
    await client.updateMcpTaskExecution(
      commandIdentity,
      [
        {
          key: "decision-a",
          result: { action: "accept", content: { approved: true } },
          verifiedResponder: {
            actorType: "user",
            actorId: "test-user-proxy",
            source: "trusted_headers",
          },
        },
      ],
      options,
    );
    await client.updateExecution(
      { ...commandIdentity, commandSequence: 8 },
      [{ key: "decision-a", value: true, answerHash: "c".repeat(64) }],
      options,
    );
    expect(routed).toHaveBeenCalledTimes(2);
    expect(routed.mock.calls[0]?.[1]).toMatchObject({
      inputs: [],
      inputResponses: [{ key: "decision-a" }],
    });
    const routedResponse = routed.mock.calls[0]?.[1].inputResponses[0];
    if (typeof routedResponse !== "object" || routedResponse === null) {
      throw new Error("ROUTED_RESPONSE_MISSING");
    }
    expect(
      protoStructToJson((routedResponse as { verifiedResponder?: unknown }).verifiedResponder),
    ).toEqual({
      actorType: "user",
      actorId: "test-user-proxy",
      source: "trusted_headers",
    });
    expect(routed.mock.calls[1]?.[1]).toMatchObject({
      inputs: [{ inputRequestKey: "decision-a", value: { boolValue: true } }],
      inputResponses: [],
    });
    expect(legacyUpdate).not.toHaveBeenCalled();
  });

  it("reads content larger than one gRPC response in bounded chunks", async () => {
    const source = Buffer.alloc(2_200_000, 7);
    const { gateway: client } = await setup(true, source);
    const chunks: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const read = await client.getBusinessArtifact(
        "task-a",
        "execution-a",
        "route-a",
        2,
        "download",
        true,
        { ...options, contentOffset: offset, maxContentBytes: 750_000 },
      );
      expect(read.contentTotalBytes).toBe(String(source.length));
      const chunk = Buffer.from(read.contentBytes ?? []);
      expect(chunk.length).toBeLessThanOrEqual(750_000);
      chunks.push(chunk);
      if (read.nextContentOffset === undefined) break;
      offset = Number(read.nextContentOffset);
    }
    expect(Buffer.concat(chunks)).toEqual(source);
  });
});
