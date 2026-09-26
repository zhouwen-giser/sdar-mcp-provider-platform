import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.js";
import { TaskBusinessGateway } from "../../apps/runtime/src/task-business-gateway.js";
import { TaskBusinessPublicService } from "../../apps/runtime/src/task-business-public.js";
import {
  UGV_READ_ONLY_BUSINESS_PROFILE,
  UgvTaskBusinessContextService,
} from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import type { AuthorizationContext, TaskRecord } from "../../packages/domain/src/index.js";
import { Sep2663ProtocolHandler } from "../../packages/mcp-protocol/src/index.js";
import type {
  ValidatedManifest,
  ValidatedOperation,
} from "../../packages/operation-registry/src/index.js";
import type { BusinessEventGeneration } from "../../packages/persistence-postgres/src/index.js";
import {
  BoundExecutionScope,
  MemoryProviderStore,
  MemoryTaskBusinessStore,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { TaskBusinessContextSchema } from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";

const taskId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1004";
const methodSnapshotPart = "io.sdar/taskBusiness/snapshotParts/get";
const providerId = "isr.vehicle.ugv.ugv1";
const streamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1007";
const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "simulation",
  simulationId: "scene-a",
};
const catalog = JSON.parse(
  readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
) as { artifacts: { artifactId: string }[] };
const contentBytes = Uint8Array.from([0, 255, 41]);
const contentSha256 = createHash("sha256").update(contentBytes).digest("hex");
const methodContext = "io.sdar/taskBusiness/context/get";
const methodArtifact = "io.sdar/taskBusiness/artifacts/get";
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

function fixture(snapshotPartsSupported = true) {
  const task = {
    taskId,
    providerId,
    operationName: "vehicle_navigate",
    operationSnapshotId: "snapshot-1",
    authorizationContextHash: authorization.hash,
    executionMode: authorization.executionMode,
    simulationId: authorization.simulationId,
    externalExecutionId: "execution-stored",
    arguments: { resourceId: "vehicle:ugv1" },
    argumentHash: "b".repeat(64),
    rootTraceparent: null,
    rootTracestate: null,
  } as unknown as TaskRecord;
  const profile = snapshotPartsSupported
    ? UGV_READ_ONLY_BUSINESS_PROFILE
    : {
        ...UGV_READ_ONLY_BUSINESS_PROFILE,
        methods: {
          contextGet: UGV_READ_ONLY_BUSINESS_PROFILE.methods.contextGet,
          artifactGet: UGV_READ_ONLY_BUSINESS_PROFILE.methods.artifactGet,
          eventsListen: UGV_READ_ONLY_BUSINESS_PROFILE.methods.eventsListen,
          contentGet: UGV_READ_ONLY_BUSINESS_PROFILE.methods.contentGet,
          inputUpdate: UGV_READ_ONLY_BUSINESS_PROFILE.methods.inputUpdate,
          interventionApply: UGV_READ_ONLY_BUSINESS_PROFILE.methods.interventionApply,
        },
      };
  const operation = {
    name: "vehicle_navigate",
    resourceBinding: { mode: "ARGUMENT_REFERENCE", resourceIdJsonPointer: "/resourceId" },
    businessFeedbackProfile: profile,
    tool: {
      name: "vehicle_navigate",
      _meta: { "io.sdar/taskBusiness": profile },
    },
  } as unknown as ValidatedOperation;
  const manifest = {
    providerId,
    providerType: "vehicle",
    providerVersion: "1.0.0",
    manifestHash: "c".repeat(64),
    operations: [operation],
    businessEventSources: [
      {
        sourceId: "vehicle.business",
        deliverySemantics: "durable_at_least_once",
        replaySupported: true,
      },
    ],
  } as ValidatedManifest;
  const calls: string[] = [];
  const events = {
    generation: {
      providerId,
      streamId,
      status: "current",
      currentSequence: "10",
      earliestAvailableSequence: "1",
      lastReplayableSequence: "10",
      lastContinuousSequence: "10",
      continuityClass: "all_durable",
    } as BusinessEventGeneration,
    currentGeneration: vi.fn(async () => {
      calls.push("watermark");
      return { ...events.generation };
    }),
  };
  const identity = {
    taskId,
    executionId: "execution-stored",
    providerId,
    resourceId: "vehicle:ugv1",
    operationName: "vehicle_navigate",
  };
  const catalogArtifact = (id: string) => {
    const found = catalog.artifacts.find((artifact) => artifact.artifactId === id);
    if (!found) throw new Error("CATALOG_ARTIFACT_MISSING");
    return found;
  };
  const first = TaskArtifactSchema.parse({
    ...catalogArtifact("destination-point"),
    artifactId: "first",
    identity,
  });
  const second = TaskArtifactSchema.parse({
    ...catalogArtifact("waypoints-multi-point"),
    artifactId: "second",
    identity,
  });
  const route = TaskArtifactSchema.parse({
    ...catalogArtifact("route-ref"),
    artifactId: "route-1",
    revision: 4,
    identity,
    content: {
      kind: "content_ref",
      artifactId: "route-1",
      revision: 4,
      readMethod: "business_artifact_content",
      handle: "route-1_4",
      mediaType: "application/octet-stream",
      sizeBytes: contentBytes.length,
      sha256: contentSha256,
    },
  });
  const context = TaskBusinessContextSchema.parse({
    schemaVersion: "sdar.task-business-context/1.0-rc2",
    contextRevision: 7,
    identity,
    effectivePlanRevision: 0,
    phase: { code: "navigation.running", since: "2026-09-24T00:00:00Z" },
    summary: { status: "in_progress" },
    activeRefs: {},
    artifactRefs: [
      { kind: "artifact", id: first.artifactId, revision: first.revision },
      { kind: "artifact", id: second.artifactId, revision: second.revision },
    ],
    actionRefs: [],
    requiredInputRefs: [],
    interventionRefs: [],
    updatedAt: "2026-09-24T00:00:00Z",
  });
  const adapter = {
    getBusinessContext: vi.fn(
      async (
        _taskId: string,
        _executionId: string,
        _max: number,
        cursor: string,
      ): Promise<Record<string, unknown>> => {
        calls.push("adapter-snapshot");
        return cursor === "adapter-page-2"
          ? {
              contextRevision: 7,
              context,
              objects: [{ kind: "artifact", value: second }],
              objectDescriptors: [],
            }
          : {
              contextRevision: 7,
              context,
              objects: [{ kind: "artifact", value: first }],
              objectDescriptors: [],
              nextCursor: "adapter-page-2",
            };
      },
    ),
    getBusinessSnapshotPart: vi.fn(
      async (
        _taskId: string,
        _executionId: string,
        selector: Parameters<GrpcAdapterGateway["getBusinessSnapshotPart"]>[2],
      ): Promise<Awaited<ReturnType<GrpcAdapterGateway["getBusinessSnapshotPart"]>>> => {
        const jsonBytes = Buffer.from(
          JSON.stringify(selector.objectRef ? { kind: "artifact", value: first } : context),
        );
        const end = Math.min(selector.offset + selector.maxBytes, jsonBytes.length);
        return {
          jsonBytes: jsonBytes.subarray(selector.offset, end),
          totalBytes: String(jsonBytes.length),
          sha256: createHash("sha256").update(jsonBytes).digest("hex"),
          ...(end < jsonBytes.length ? { nextOffset: String(end) } : {}),
        };
      },
    ),
    getBusinessArtifact: vi.fn(
      async (): Promise<Awaited<ReturnType<GrpcAdapterGateway["getBusinessArtifact"]>>> => ({
        artifact: route,
        contentBytes,
        mediaType: "application/octet-stream",
        sha256: contentSha256,
        contentTotalBytes: "3",
      }),
    ),
  };
  const gateway = new TaskBusinessGateway(
    manifest,
    { getAuthorized: vi.fn(async () => task) },
    {
      loadOperationSnapshot: vi.fn(async () => ({
        snapshotId: task.operationSnapshotId,
        providerId,
        providerVersion: "1.0.0",
        manifestHash: "c".repeat(64),
        operation,
      })),
    },
    adapter,
  );
  const endpoint = new TaskBusinessPublicService(providerId, gateway, events);
  const handler = new Sep2663ProtocolHandler(
    manifest,
    "2.0.0-rc.1",
    undefined,
    () => authorization,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    endpoint,
  );
  return { calls, events, adapter, endpoint, handler, context, first, second, route };
}

async function start(handler: Sep2663ProtocolHandler): Promise<string> {
  const server = createServer((request, response) => {
    void (async () => {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      await handler.handle(request, response, JSON.parse(raw) as unknown);
    })();
  });
  servers.push(server);
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("HTTP_ADDRESS_INVALID"));
      else resolve(address.port);
    });
  });
  return `http://127.0.0.1:${port}/mcp`;
}

async function send(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  capability = true,
) {
  const request = {
    jsonrpc: "2.0",
    id: "wire-1",
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "business-wire", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {
          extensions: {
            "io.modelcontextprotocol/tasks": {},
            ...(capability ? { "io.sdar/taskBusiness": { profileVersion: "1.0-rc2" } } : {}),
          },
        },
      },
    },
  };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(typeof params.taskId === "string" ? { "mcp-name": params.taskId } : {}),
    },
    body: JSON.stringify(request),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function result(response: { body: Record<string, unknown> }): Record<string, unknown> {
  return response.body.result as Record<string, unknown>;
}
function reason(response: { body: Record<string, unknown> }): string | undefined {
  return ((response.body.error as Record<string, unknown>)?.data as Record<string, unknown>)
    ?.reasonCode as string | undefined;
}

describe("public TaskBusiness /mcp wire", () => {
  it("does not advertise or call snapshot parts for an older operation profile", async () => {
    const { handler, adapter, context, first } = fixture(false);
    const url = await start(handler);
    const discovery = await send(url, "server/discover");
    expect(discovery.status).toBe(200);
    const extensions = (result(discovery).capabilities as Record<string, unknown>)
      .extensions as Record<string, unknown>;
    const business = extensions["io.sdar/taskBusiness"] as Record<string, unknown>;
    expect((business.methods as Record<string, unknown>).snapshotPartGet).toBeUndefined();

    const page = await send(url, methodContext, { taskId });
    expect(page.status).toBe(200);
    const token = result(page).snapshotToken;
    expect(token).toBeTypeOf("string");
    const part = await send(url, methodSnapshotPart, { taskId, snapshotToken: token });
    expect(part.status).not.toBe(200);
    expect(reason(part)).toBe("BUSINESS_SNAPSHOT_PART_NOT_SUPPORTED");
    expect(adapter.getBusinessSnapshotPart).not.toHaveBeenCalled();

    adapter.getBusinessContext.mockResolvedValueOnce({
      contextRevision: context.contextRevision,
      context,
      objects: [],
      objectDescriptors: [
        {
          ref: { kind: "artifact", id: first.artifactId, revision: first.revision },
          sizeBytes: Buffer.byteLength(JSON.stringify({ kind: "artifact", value: first })),
          readMethod: "getObjectVersion",
        },
      ],
    });
    const descriptorPage = await send(url, methodContext, { taskId });
    expect(descriptorPage.status).not.toBe(200);
    expect(reason(descriptorPage)).toBe("BUSINESS_SNAPSHOT_DESCRIPTOR_UNSUPPORTED");
    expect(adapter.getBusinessSnapshotPart).not.toHaveBeenCalled();
  });

  it("discovers only an advertised business profile and its method names", async () => {
    const { handler } = fixture();
    const url = await start(handler);
    const discovery = await send(url, "server/discover");
    expect(discovery.status).toBe(200);
    const extensions = (result(discovery).capabilities as Record<string, unknown>)
      .extensions as Record<string, unknown>;
    expect(extensions["io.sdar/taskBusiness"]).toMatchObject({
      profileVersion: "1.0-rc2",
      schemaVersion: "sdar.task-business-public-query/1.0-rc2",
      methods: {
        contextGet: methodContext,
        snapshotPartGet: methodSnapshotPart,
        artifactGet: methodArtifact,
      },
    });
    const business = extensions["io.sdar/taskBusiness"] as Record<string, unknown>;
    expect((business.methods as Record<string, unknown>).interventionApply).toBeUndefined();
    const ajv = new Ajv2020({ strict: true });
    for (const key of [
      "contextQuerySchema",
      "artifactQuerySchema",
      "contextResultSchema",
      "artifactResultSchema",
      "snapshotPartQuerySchema",
      "snapshotPartResultSchema",
    ]) {
      expect(ajv.compile(business[key] as Record<string, unknown>)).toBeTypeOf("function");
    }
    const tools = await send(url, "tools/list");
    expect(
      ((result(tools).tools as Record<string, unknown>[])[0]?._meta as Record<string, unknown>)[
        "io.sdar/taskBusiness"
      ],
    ).toBeDefined();
  });

  it("does not advertise or queue an Intervention for the selected read-only UGV profile", async () => {
    const { handler, adapter } = fixture();
    const url = await start(handler);
    const response = await send(url, "io.sdar/taskBusiness/interventions/apply", {
      schemaVersion: "sdar.runtime-intervention-command/1.0-rc2",
      commandId: "unqualified-adjustment",
      taskId,
      executionId: "execution-stored",
      interventionId: "unqualified-entry",
      guard: {
        mode: "semantic",
        expectedInterventionRevision: 1,
        expectedEffectivePlanRevision: 0,
      },
      input: { destination: [116.1, 39.1] },
    });
    expect(response.status).toBe(400);
    expect(reason(response)).toBe("BUSINESS_INTERVENTION_NOT_SUPPORTED");
    expect(adapter.getBusinessContext).not.toHaveBeenCalled();
  });

  it("takes public C before Adapter R, freezes C and R across pages, and encodes content bytes", async () => {
    const { handler, calls, events, adapter } = fixture();
    const url = await start(handler);
    const discovery = await send(url, "server/discover");
    const extensions = (result(discovery).capabilities as Record<string, unknown>)
      .extensions as Record<string, unknown>;
    const schemas = extensions["io.sdar/taskBusiness"] as Record<string, unknown>;
    const ajv = new Ajv2020({ strict: true });
    const validContext = ajv.compile(schemas.contextResultSchema as Record<string, unknown>);
    const validArtifact = ajv.compile(schemas.artifactResultSchema as Record<string, unknown>);
    const first = await send(url, methodContext, { taskId, maxPageBytes: 8192 });
    expect(first.status).toBe(200);
    expect(validContext(result(first))).toBe(true);
    expect(calls).toEqual(["watermark", "adapter-snapshot", "watermark"]);
    expect(result(first)).toMatchObject({
      resultType: "complete",
      profileVersion: "1.0-rc2",
      resumeFrom: { streamId, afterSequence: "10" },
      snapshot: { contextRevision: 7, objects: [{ value: { artifactId: "first" } }] },
    });
    const cursor = (result(first).snapshot as Record<string, unknown>).nextCursor;
    expect(typeof cursor).toBe("string");
    events.generation.currentSequence = "12";
    const second = await send(url, methodContext, {
      taskId,
      maxPageBytes: 8192,
      pageCursor: cursor,
    });
    expect(second.status).toBe(200);
    expect(result(second)).toMatchObject({
      resumeFrom: { streamId, afterSequence: "10" },
      snapshot: { contextRevision: 7, objects: [{ value: { artifactId: "second" } }] },
    });
    expect((result(second).snapshot as Record<string, unknown>).nextCursor).toBeUndefined();
    expect(adapter.getBusinessContext).toHaveBeenLastCalledWith(
      taskId,
      "execution-stored",
      8192,
      "adapter-page-2",
      expect.any(Object),
    );
    const artifact = await send(url, methodArtifact, {
      taskId,
      artifactId: "route-1",
      revision: 4,
      includeContent: true,
      contentOffset: 0,
      maxContentBytes: 1024,
    });
    expect(artifact.status).toBe(200);
    expect(validArtifact(result(artifact))).toBe(true);
    expect(result(artifact)).toMatchObject({
      resultType: "complete",
      artifact: { artifactId: "route-1", revision: 4 },
      content: { encoding: "base64", bytes: "AP8p", totalBytes: "3", offset: 0 },
    });
    expect(adapter.getBusinessArtifact).toHaveBeenCalledWith(
      taskId,
      "execution-stored",
      "route-1",
      4,
      "",
      true,
      expect.objectContaining({ contentOffset: 0, maxContentBytes: 1024 }),
    );
  });

  it("accepts an omitted optional Provider simulation ID but rejects an explicitly different scene", async () => {
    const { handler, adapter, context: providerContext } = fixture();
    const url = await start(handler);
    const actualShape = await send(url, methodContext, { taskId });
    expect(actualShape.status).toBe(200);
    expect(result(actualShape).snapshot).toMatchObject({ context: providerContext });
    adapter.getBusinessContext.mockResolvedValueOnce({
      contextRevision: 7,
      context: {
        ...providerContext,
        identity: { ...providerContext.identity, simulationId: "scene-other" },
      },
      objects: [],
      objectDescriptors: [],
    });
    const inconsistent = await send(url, methodContext, { taskId });
    expect(reason(inconsistent)).toBe("BUSINESS_SNAPSHOT_PAGE_INVALID");
  });

  it("checks immutable content metadata and bounded chunk continuation before publishing bytes", async () => {
    const { handler, adapter, route } = fixture();
    const url = await start(handler);
    const read = (options: Record<string, unknown> = {}) =>
      send(url, methodArtifact, {
        taskId,
        artifactId: "route-1",
        revision: 4,
        includeContent: true,
        ...options,
      });
    adapter.getBusinessArtifact.mockResolvedValueOnce({
      artifact: route,
      contentBytes: contentBytes.subarray(0, 2),
      mediaType: "application/octet-stream",
      sha256: contentSha256,
      contentTotalBytes: "3",
      nextContentOffset: "2",
    });
    const first = await read({ maxContentBytes: 2 });
    expect(first.status).toBe(200);
    expect(result(first).content).toMatchObject({ bytes: "AP8=", offset: 0, nextOffset: "2" });
    adapter.getBusinessArtifact.mockResolvedValueOnce({
      artifact: route,
      contentBytes: contentBytes.subarray(2),
      mediaType: "application/octet-stream",
      sha256: contentSha256,
      contentTotalBytes: "3",
    });
    const second = await read({ contentOffset: 2, maxContentBytes: 2 });
    expect(second.status).toBe(200);
    expect(result(second).content).toMatchObject({ bytes: "KQ==", offset: 2 });

    for (const corrupted of [
      { sha256: "f".repeat(64) },
      { contentTotalBytes: "4" },
      { nextContentOffset: "1" },
    ]) {
      adapter.getBusinessArtifact.mockResolvedValueOnce({
        artifact: route,
        contentBytes: contentBytes.subarray(0, 2),
        mediaType: "application/octet-stream",
        sha256: contentSha256,
        contentTotalBytes: "3",
        nextContentOffset: "2",
        ...corrupted,
      });
      expect(reason(await read({ maxContentBytes: 2 }))).toBe("BUSINESS_ARTIFACT_CONTENT_INVALID");
    }
    adapter.getBusinessArtifact.mockResolvedValueOnce({
      artifact: route,
      contentBytes: contentBytes.subarray(0, 2),
      mediaType: "application/octet-stream",
      sha256: contentSha256,
      contentTotalBytes: "3",
    });
    expect(reason(await read({ maxContentBytes: 2 }))).toBe("BUSINESS_ARTIFACT_CONTENT_INVALID");
    adapter.getBusinessArtifact.mockResolvedValueOnce({
      artifact: route,
      contentBytes: Uint8Array.from([0, 255, 42]),
      mediaType: "application/octet-stream",
      sha256: contentSha256,
      contentTotalBytes: "3",
    });
    expect(reason(await read())).toBe("BUSINESS_ARTIFACT_CONTENT_INVALID");
  });

  it("reads the actual Provider-created Context shape for a simulated Task", async () => {
    const run: ProviderExecution = {
      taskId,
      externalExecutionId: "execution-stored",
      operationName: "vehicle_navigate",
      argumentHash: "b".repeat(64),
      providerId,
      resourceId: "vehicle:ugv1",
      tracks: [],
      arguments: { resourceId: "vehicle:ugv1" },
      executionContext: {
        authorizationContextHash: authorization.hash,
        executionMode: "simulation",
        simulationId: "scene-a",
        correlationId: "correlation-a",
      },
      taskBusinessContextExpected: true,
      downstreamMissionIds: [],
      state: "ACCEPTED",
      revision: 1,
      reasonCode: "UGV_OPERATION_ACCEPTED",
      createdAt: "2026-09-24T00:00:00Z",
      updatedAt: "2026-09-24T00:00:00Z",
      evidence: [],
    };
    const executions = new MemoryProviderStore();
    const business = new MemoryTaskBusinessStore();
    await executions.putExecution(run);
    await new UgvTaskBusinessContextService(
      executions,
      business,
      providerId,
      run.resourceId,
      () => undefined,
    ).ensureForCreatedExecution(taskId);
    const page = await business.getContextSnapshotPage(
      BoundExecutionScope.fromExecution(run),
      8192,
    );
    expect(page?.context?.identity.simulationId).toBeUndefined();
    const { handler, adapter } = fixture();
    adapter.getBusinessContext.mockResolvedValueOnce(page as unknown as Record<string, unknown>);
    const response = await send(await start(handler), methodContext, {
      taskId,
      maxPageBytes: 8192,
    });
    expect(response.status).toBe(200);
    expect(result(response).snapshot).toMatchObject({ context: page?.context });
  });

  it("rejects foreign or unreferenced Adapter objects and a foreign Artifact read", async () => {
    const { handler, adapter, context, first, route } = fixture();
    const url = await start(handler);
    adapter.getBusinessContext.mockResolvedValueOnce({
      contextRevision: 7,
      context,
      objects: [
        { kind: "artifact", value: { ...first, identity: { ...first.identity, taskId: "other" } } },
      ],
      objectDescriptors: [],
    });
    expect(reason(await send(url, methodContext, { taskId }))).toBe(
      "BUSINESS_SNAPSHOT_OBJECT_INVALID",
    );
    adapter.getBusinessContext.mockResolvedValueOnce({
      contextRevision: 7,
      context,
      objects: [{ kind: "artifact", value: { ...first, artifactId: "not-in-context" } }],
      objectDescriptors: [],
    });
    expect(reason(await send(url, methodContext, { taskId }))).toBe(
      "BUSINESS_SNAPSHOT_OBJECT_INVALID",
    );
    adapter.getBusinessArtifact.mockResolvedValueOnce({
      artifact: { ...route, identity: { ...route.identity, taskId: "other" } },
      contentBytes,
      mediaType: "application/octet-stream",
      sha256: contentSha256,
      contentTotalBytes: "3",
    });
    expect(reason(await send(url, methodArtifact, { taskId, artifactId: "route-1" }))).toBe(
      "BUSINESS_ARTIFACT_RESPONSE_INVALID",
    );
  });

  it("rejects changed generation, expired replay, mismatched revision and altered page cursor", async () => {
    const { handler, events, adapter } = fixture();
    const url = await start(handler);
    const first = await send(url, methodContext, { taskId });
    const cursor = (result(first).snapshot as Record<string, unknown>).nextCursor as string;
    const changed = await send(url, methodContext, { taskId, pageCursor: `${cursor}x` });
    expect(reason(changed)).toBe("BUSINESS_SNAPSHOT_CURSOR_INVALID");
    adapter.getBusinessContext.mockResolvedValueOnce({ contextRevision: 8, objects: [] });
    const revision = await send(url, methodContext, { taskId, pageCursor: cursor });
    expect(reason(revision)).toBe("BUSINESS_SNAPSHOT_REVISION_CHANGED");
    events.generation.earliestAvailableSequence = "12";
    const expired = await send(url, methodContext, { taskId, pageCursor: cursor });
    expect(reason(expired)).toBe("BUSINESS_EVENT_CURSOR_EXPIRED");
    events.generation.earliestAvailableSequence = "1";
    events.generation.streamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1008";
    const reset = await send(url, methodContext, { taskId, pageCursor: cursor });
    expect(reason(reset)).toBe("BUSINESS_EVENT_STREAM_RESET");
  });

  it("reads Context and exact object descriptors while rejecting malformed descriptors and rotation", async () => {
    const { handler, events, adapter, context, first } = fixture();
    const url = await start(handler);
    const object = { kind: "artifact", value: first };
    const ref = { kind: "artifact", id: first.artifactId, revision: first.revision };
    adapter.getBusinessContext.mockResolvedValueOnce({
      contextRevision: 7,
      contextDescriptor: {
        revision: 7,
        sizeBytes: Buffer.byteLength(JSON.stringify(context)),
        readMethod: "getContext",
      },
      objects: [],
      objectDescriptors: [
        {
          ref,
          sizeBytes: Buffer.byteLength(JSON.stringify(object)),
          readMethod: "getObjectVersion",
        },
      ],
    });
    const descriptor = await send(url, methodContext, { taskId });
    expect(descriptor.status).toBe(200);
    const snapshotToken = result(descriptor).snapshotToken;
    expect(typeof snapshotToken).toBe("string");
    expect(result(descriptor).snapshot).toMatchObject({
      contextDescriptor: { revision: 7 },
      objectDescriptors: [{ ref }],
    });
    const contextPart = await send(url, methodSnapshotPart, { taskId, snapshotToken });
    expect(contextPart.status).toBe(200);
    const readBytes = (response: Awaited<ReturnType<typeof send>>) => {
      const encoded = (result(response).part as { bytes?: unknown }).bytes;
      if (typeof encoded !== "string") throw new Error("PART_BYTES_MISSING");
      return Buffer.from(encoded, "base64").toString("utf8");
    };
    expect(JSON.parse(readBytes(contextPart))).toEqual(context);
    const objectPart = await send(url, methodSnapshotPart, {
      taskId,
      snapshotToken,
      objectRef: ref,
    });
    expect(objectPart.status).toBe(200);
    expect(JSON.parse(readBytes(objectPart))).toEqual(object);
    adapter.getBusinessContext.mockResolvedValueOnce({
      contextRevision: 7,
      contextDescriptor: { revision: 7 },
      objects: [],
      objectDescriptors: [],
    });
    const malformed = await send(url, methodContext, { taskId });
    expect(reason(malformed)).toBe("BUSINESS_SNAPSHOT_DESCRIPTOR_INVALID");
    adapter.getBusinessContext.mockImplementationOnce(async () => {
      events.generation.streamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1008";
      return {
        contextRevision: 7,
        context,
        objects: [{ kind: "artifact", value: first }],
        objectDescriptors: [],
      };
    });
    const rotated = await send(url, methodContext, { taskId });
    expect(reason(rotated)).toBe("BUSINESS_EVENT_STREAM_RESET");
  });

  it("requires headers, extension capability, authorized binding and valid query parameters", async () => {
    const { handler, adapter } = fixture();
    const url = await start(handler);
    const missing = await send(url, methodContext, { taskId }, false);
    expect(missing.status).toBe(400);
    expect((missing.body.error as Record<string, unknown>).code).toBe(-32003);
    const mismatch = await send(url, methodContext, { taskId, externalExecutionId: "untrusted" });
    expect(reason(mismatch)).toBe("BUSINESS_EXECUTION_ID_MISMATCH");
    const otherTask = await send(url, methodContext, {
      taskId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1005",
    });
    expect(reason(otherTask)).toBe("TASK_NOT_FOUND");
    const invalid = await send(url, methodContext, { taskId, maxPageBytes: 1 });
    expect(invalid.status).toBe(400);
    expect(reason(invalid)).toBe("BUSINESS_PAGE_SIZE_INVALID");
    expect(adapter.getBusinessContext).not.toHaveBeenCalled();
  });
});
