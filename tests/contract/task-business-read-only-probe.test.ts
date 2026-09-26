import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { runReadOnlyTaskBusinessProbe } from "../../scripts/task-business/read-only-probe.js";
import { TaskBusinessContextSchema } from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";

const catalog = JSON.parse(
  readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
) as {
  context: unknown;
  feedback: unknown[];
  artifacts: Record<string, unknown>[];
  action: Record<string, unknown>;
  requiredInput: Record<string, unknown>;
  intervention: Record<string, unknown>;
};
const taskId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1004";
const streamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1007";
const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1008";
const context = TaskBusinessContextSchema.parse({
  ...(catalog.context as Record<string, unknown>),
  identity: { ...(catalog.context as { identity: Record<string, unknown> }).identity, taskId },
});
const routeLine = catalog.artifacts.find((item) => item.artifactId === "route-line");
if (!routeLine) throw new Error("CATALOG_ROUTE_LINE_MISSING");
const snapshotObjects = [
  { kind: "artifact", value: { ...routeLine, identity: context.identity } },
  { kind: "action", value: { ...catalog.action, identity: context.identity } },
  { kind: "input_request", value: { ...catalog.requiredInput, identity: context.identity } },
  { kind: "intervention", value: { ...catalog.intervention, identity: context.identity } },
];
const contentBytes = Uint8Array.from([0, 255, 41]);
const contentSha256 = createHash("sha256").update(contentBytes).digest("hex");
const routeCatalog = catalog.artifacts.find((item) => item.artifactId === "route-ref");
if (!routeCatalog) throw new Error("CATALOG_ROUTE_MISSING");
const routeContent = {
  kind: "content_ref",
  artifactId: "route-probe",
  revision: 4,
  readMethod: "business_artifact_content",
  handle: "route-probe_4",
  mediaType: "application/octet-stream",
  sizeBytes: contentBytes.length,
  sha256: contentSha256,
} as const;
const route = TaskArtifactSchema.parse({
  ...routeCatalog,
  artifactId: "route-probe",
  revision: 4,
  identity: context.identity,
  content: routeContent,
});

function notification(sequence: string, sourceId: string, eventTaskId = taskId, feedbackIndex = 0) {
  return {
    jsonrpc: "2.0",
    method: "notifications/io.sdar/businessEvents",
    params: {
      streamId,
      sequence,
      eventId: `public-event-${sequence}`,
      sourceId,
      sourceStreamId,
      sourceSequence: sequence,
      sourceEventId: `source-event-${sequence}`,
      eventType:
        sourceId === "vehicle.business" ? "vehicle.business.changed" : "vehicle.execution.changed",
      scope: "task",
      taskId: eventTaskId,
      occurredAt: "2026-09-23T00:02:00Z",
      rawPayload:
        sourceId === "vehicle.business"
          ? { ...(catalog.feedback[feedbackIndex] as Record<string, unknown>), contextRevision: 5 }
          : {},
    },
  };
}

function sse(message: unknown): string {
  return `data: ${JSON.stringify(message)}\r\n\r\n`;
}

function nonObjectLines(lines: Record<string, unknown>[]): Record<string, unknown>[] {
  return lines.filter((line) => line.type !== "businessObject");
}

describe("read-only public business probe", () => {
  it.each(["valid", "bad-digest"] as const)(
    "hydrates chunked Context and Action descriptors before reducer bootstrap (case=%s)",
    async (scenario) => {
      const largeContext = TaskBusinessContextSchema.parse({
        ...context,
        summary: { status: "in_progress", properties: { detail: "c".repeat(90_000) } },
      });
      const largeAction = {
        ...catalog.action,
        identity: context.identity,
        properties: { detail: "a".repeat(90_000) },
      };
      const actionObject = { kind: "action", value: largeAction };
      const contextBytes = Buffer.from(JSON.stringify(largeContext));
      const actionBytes = Buffer.from(JSON.stringify(actionObject));
      const actionRef = context.actionRefs[0];
      if (!actionRef) throw new Error("ACTION_REF_MISSING");
      const methods: string[] = [];
      const fetchImpl: typeof fetch = async (_input, init) => {
        if (typeof init?.body !== "string") throw new Error("TEST_BODY_INVALID");
        const envelope = JSON.parse(init.body) as {
          id: string;
          method: string;
          params: Record<string, unknown>;
        };
        methods.push(envelope.method);
        if (envelope.method === "io.sdar/taskBusiness/context/get") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: envelope.id,
              result: {
                resultType: "complete",
                profileVersion: "1.0-rc2",
                snapshotToken: "fixture-token",
                snapshot: {
                  contextRevision: largeContext.contextRevision,
                  contextDescriptor: {
                    revision: largeContext.contextRevision,
                    sizeBytes: contextBytes.length,
                    readMethod: "getContext",
                  },
                  objects: snapshotObjects.filter((item) => item.kind !== "action"),
                  objectDescriptors: [
                    {
                      ref: actionRef,
                      sizeBytes: actionBytes.length,
                      readMethod: "getObjectVersion",
                    },
                  ],
                },
                resumeFrom: { streamId, afterSequence: "5" },
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (envelope.method === "io.sdar/taskBusiness/snapshotParts/get") {
          const isAction = envelope.params.objectRef !== undefined;
          const bytes = isAction ? actionBytes : contextBytes;
          const offset = envelope.params.offset;
          if (typeof offset !== "number") throw new Error("PART_OFFSET_INVALID");
          const end = Math.min(offset + 65_536, bytes.length);
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: envelope.id,
              result: {
                resultType: "complete",
                profileVersion: "1.0-rc2",
                part: {
                  encoding: "base64",
                  bytes: bytes.subarray(offset, end).toString("base64"),
                  totalBytes: String(bytes.length),
                  sha256:
                    isAction && scenario === "bad-digest"
                      ? "0".repeat(64)
                      : createHash("sha256").update(bytes).digest("hex"),
                  offset,
                  ...(end < bytes.length ? { nextOffset: String(end) } : {}),
                },
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        expect(envelope.method).toBe("io.sdar/businessEvents/listen");
        return new Response(
          sse({
            jsonrpc: "2.0",
            method: "notifications/io.sdar/businessEvents/acknowledged",
            params: { streamId, acceptedAfterSequence: "5" },
          }) + sse(notification("6", "vehicle.business")),
          { headers: { "content-type": "text/event-stream" } },
        );
      };
      const lines: Record<string, unknown>[] = [];
      const run = runReadOnlyTaskBusinessProbe({
        mcpUrl: "http://127.0.0.1:1/mcp",
        taskId,
        maxEvents: 1,
        durationMs: 10_000,
        fetchImpl,
        emit: (line) => {
          lines.push(line);
        },
      });
      if (scenario === "bad-digest") {
        await expect(run).rejects.toThrow("BUSINESS_PROBE_SNAPSHOT_DIGEST_MISMATCH");
        expect(lines.at(-1)).toMatchObject({ type: "stopped", reason: "failed" });
      } else {
        await run;
        expect(lines.find((line) => line.type === "snapshot")).toMatchObject({ objectCount: 4 });
        expect(lines.filter((line) => line.type === "businessObject")).toHaveLength(4);
      }
      expect(methods.filter((method) => method.endsWith("snapshotParts/get"))).toHaveLength(4);
    },
  );

  it("accepts one transport chunk containing many bounded SSE frames", async () => {
    const ignored = sse({
      jsonrpc: "2.0",
      method: "notifications/ignored",
      params: { padding: "x".repeat(1_024) },
    });
    let batch =
      sse({
        jsonrpc: "2.0",
        method: "notifications/io.sdar/businessEvents/acknowledged",
        params: { streamId, acceptedAfterSequence: "5" },
      }) +
      ignored.repeat(Math.ceil(2_300_000 / ignored.length)) +
      sse(notification("6", "vehicle.business"));
    const fetchImpl: typeof fetch = async (_input, init) => {
      if (typeof init?.body !== "string") throw new Error("TEST_BODY_INVALID");
      const envelope = JSON.parse(init.body) as { id: string; method: string };
      if (envelope.method === "io.sdar/taskBusiness/context/get") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: envelope.id,
            result: {
              resultType: "complete",
              profileVersion: "1.0-rc2",
              snapshot: {
                contextRevision: context.contextRevision,
                context,
                objects: snapshotObjects,
                objectDescriptors: [],
              },
              resumeFrom: { streamId, afterSequence: "5" },
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      expect(envelope.method).toBe("io.sdar/businessEvents/listen");
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(batch));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const lines: Record<string, unknown>[] = [];
    await runReadOnlyTaskBusinessProbe({
      mcpUrl: "http://127.0.0.1:1/mcp",
      taskId,
      maxEvents: 1,
      durationMs: 10_000,
      fetchImpl,
      emit: (line) => {
        lines.push(line);
      },
    });
    expect(lines.filter((line) => line.type === "businessEvent")).toHaveLength(1);
    expect(lines.at(-1)).toMatchObject({ type: "stopped", reason: "max_events" });

    batch = sse({
      jsonrpc: "2.0",
      method: "notifications/ignored",
      params: { padding: "x".repeat(2_097_153) },
    });
    await expect(
      runReadOnlyTaskBusinessProbe({
        mcpUrl: "http://127.0.0.1:1/mcp",
        taskId,
        maxEvents: 1,
        durationMs: 10_000,
        fetchImpl,
        emit: () => undefined,
      }),
    ).rejects.toThrow("BUSINESS_PROBE_SSE_FRAME_TOO_LARGE");
  });

  it.each(["valid", "bad-digest", "changed-ref"] as const)(
    "assembles public Artifact chunks and rejects corruption (case=%s)",
    async (scenario) => {
      const methods: string[] = [];
      const offsets: number[] = [];
      const server = createServer((request, response) => {
        void (async () => {
          let raw = "";
          for await (const chunk of request) raw += String(chunk);
          const envelope = JSON.parse(raw) as {
            id: string;
            method: string;
            params: Record<string, unknown>;
          };
          methods.push(envelope.method);
          if (envelope.method === "io.sdar/taskBusiness/context/get") {
            response.setHeader("content-type", "application/json");
            response.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: envelope.id,
                result: {
                  resultType: "complete",
                  profileVersion: "1.0-rc2",
                  snapshot: {
                    contextRevision: context.contextRevision,
                    context: {
                      ...context,
                      artifactRefs: [
                        ...context.artifactRefs,
                        { kind: "artifact", id: route.artifactId, revision: route.revision },
                      ],
                    },
                    objects: [...snapshotObjects, { kind: "artifact", value: route }],
                    objectDescriptors: [],
                  },
                  resumeFrom: { streamId, afterSequence: "5" },
                },
              }),
            );
            return;
          }
          if (envelope.method === "io.sdar/taskBusiness/artifacts/get") {
            expect(request.headers["mcp-name"]).toBe(taskId);
            const offset = envelope.params.contentOffset;
            expect(typeof offset).toBe("number");
            offsets.push(offset as number);
            const first = offset === 0;
            response.setHeader("content-type", "application/json");
            response.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: envelope.id,
                result: {
                  resultType: "complete",
                  profileVersion: "1.0-rc2",
                  artifact:
                    !first && scenario === "changed-ref"
                      ? {
                          ...route,
                          content: { ...routeContent, handle: "route-probe_altered" },
                        }
                      : route,
                  content: {
                    encoding: "base64",
                    bytes: first ? "AP8=" : scenario === "bad-digest" ? "Kg==" : "KQ==",
                    mediaType: "application/octet-stream",
                    sha256: contentSha256,
                    totalBytes: "3",
                    offset,
                    ...(first ? { nextOffset: "2" } : {}),
                  },
                },
              }),
            );
            return;
          }
          expect(envelope.method).toBe("io.sdar/businessEvents/listen");
          response.setHeader("content-type", "text/event-stream");
          response.end(
            sse({
              jsonrpc: "2.0",
              method: "notifications/io.sdar/businessEvents/acknowledged",
              params: { streamId, acceptedAfterSequence: "5" },
            }) + sse(notification("6", "vehicle.business")),
          );
        })().catch((error: unknown) => response.destroy(error as Error));
      });
      const port = await new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string") reject(new Error("HTTP_BIND_FAILED"));
          else resolve(address.port);
        });
      });
      try {
        const lines: Record<string, unknown>[] = [];
        const run = runReadOnlyTaskBusinessProbe({
          mcpUrl: `http://127.0.0.1:${port}/mcp`,
          taskId,
          artifactId: route.artifactId,
          artifactRevision: route.revision,
          artifactChunkBytes: 2,
          maxEvents: 1,
          durationMs: 2_000,
          emit: (line) => {
            lines.push(line);
          },
        });
        if (scenario !== "valid") {
          await expect(run).rejects.toThrow(
            scenario === "bad-digest"
              ? "BUSINESS_PROBE_ARTIFACT_DIGEST_MISMATCH"
              : "BUSINESS_PROBE_ARTIFACT_REF_CHANGED",
          );
          expect(nonObjectLines(lines).map((line) => line.type)).toEqual([
            "snapshot",
            "error",
            "stopped",
          ]);
          expect(methods).toEqual([
            "io.sdar/taskBusiness/context/get",
            "io.sdar/taskBusiness/artifacts/get",
            "io.sdar/taskBusiness/artifacts/get",
          ]);
        } else {
          await run;
          expect(nonObjectLines(lines).map((line) => line.type)).toEqual([
            "snapshot",
            "artifactContent",
            "businessEvent",
            "cursor",
            "stopped",
          ]);
          expect(nonObjectLines(lines)[1]).toMatchObject({
            artifactId: route.artifactId,
            revision: 4,
            sizeBytes: 3,
            sha256: contentSha256,
            chunks: 2,
          });
        }
        const objects = lines.filter((line) => line.type === "businessObject");
        expect(objects).toHaveLength(5);
        expect(objects.map((line) => (line.object as { kind: string }).kind)).toEqual([
          "artifact",
          "action",
          "input_request",
          "intervention",
          "artifact",
        ]);
        expect(objects[1]).toMatchObject({
          contextRevision: context.contextRevision,
          resumeFrom: { streamId, afterSequence: "5" },
          object: { kind: "action", value: { actionId: "lock-1", revision: 1 } },
        });
        expect(lines[0]).toMatchObject({ type: "snapshot", objectCount: 5 });
        expect(offsets).toEqual([0, 2]);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it("paginates public Context, resumes SSE across connections and emits normalized NDJSON", async () => {
    const methods: string[] = [];
    const requestedCursors: unknown[] = [];
    let queryAttempts = 0;
    let pageCount = 0;
    let listenCount = 0;
    const server = createServer((request, response) => {
      void (async () => {
        let raw = "";
        for await (const chunk of request) raw += String(chunk);
        const envelope = JSON.parse(raw) as {
          id: string;
          method: string;
          params: Record<string, unknown>;
        };
        methods.push(envelope.method);
        if (envelope.method === "io.sdar/taskBusiness/context/get") {
          expect(request.headers["mcp-name"]).toBe(taskId);
          queryAttempts += 1;
          if (queryAttempts === 1) {
            response.statusCode = 409;
            response.setHeader("content-type", "application/json");
            response.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: envelope.id,
                error: { code: -32602, data: { reasonCode: "BUSINESS_EVENT_STREAM_RESET" } },
              }),
            );
            return;
          }
          pageCount += 1;
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: envelope.id,
              result: {
                resultType: "complete",
                profileVersion: "1.0-rc2",
                snapshot: {
                  contextRevision: 4,
                  context,
                  objects: pageCount === 1 ? snapshotObjects.slice(0, 2) : snapshotObjects.slice(2),
                  objectDescriptors: [],
                  ...(pageCount === 1 ? { nextCursor: "opaque-page-two" } : {}),
                },
                resumeFrom: { streamId, afterSequence: "5" },
              },
            }),
          );
          return;
        }
        expect(envelope.method).toBe("io.sdar/businessEvents/listen");
        expect(request.headers["mcp-name"]).toBeUndefined();
        requestedCursors.push(envelope.params.cursor);
        listenCount += 1;
        response.setHeader("content-type", "text/event-stream");
        response.write(
          sse({
            jsonrpc: "2.0",
            method: "notifications/io.sdar/businessEvents/acknowledged",
            params: { streamId, acceptedAfterSequence: listenCount === 1 ? "5" : "7" },
          }),
        );
        if (listenCount === 1) {
          const frames =
            sse(notification("6", "vehicle.execution")) +
            sse(notification("7", "vehicle.business", "other-task"));
          response.write(frames.slice(0, 37));
          response.end(frames.slice(37));
        } else {
          const frames =
            sse(notification("8", "vehicle.business", taskId, 0)) +
            sse(notification("9", "vehicle.business", taskId, 2));
          response.write(frames.slice(0, 39));
          response.end(frames.slice(39));
        }
      })().catch((error: unknown) => response.destroy(error as Error));
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") reject(new Error("HTTP_BIND_FAILED"));
        else resolve(address.port);
      });
    });
    try {
      const lines: Record<string, unknown>[] = [];
      await runReadOnlyTaskBusinessProbe({
        mcpUrl: `http://127.0.0.1:${port}/mcp`,
        taskId,
        maxEvents: 2,
        durationMs: 2_000,
        emit: (line) => {
          lines.push(line);
        },
      });
      expect(pageCount).toBe(2);
      expect(listenCount).toBe(2);
      expect(methods).toEqual([
        "io.sdar/taskBusiness/context/get",
        "io.sdar/taskBusiness/context/get",
        "io.sdar/taskBusiness/context/get",
        "io.sdar/businessEvents/listen",
        "io.sdar/businessEvents/listen",
      ]);
      expect(requestedCursors).toEqual([
        { streamId, afterSequence: "5" },
        { streamId, afterSequence: "7" },
      ]);
      expect(nonObjectLines(lines).map((line) => line.type)).toEqual([
        "refresh",
        "snapshot",
        "cursor",
        "cursor",
        "businessEvent",
        "cursor",
        "businessEvent",
        "cursor",
        "stopped",
      ]);
      expect(lines.filter((line) => line.type === "businessEvent")).toMatchObject([
        { taskId, kind: "BUSINESS_EVENT", contextRevision: 5 },
        { taskId, kind: "ACTION_CHANGED", contextRevision: 5 },
      ]);
      expect(lines.filter((line) => line.type === "businessObject")).toHaveLength(4);
      expect(lines.at(-1)).toMatchObject({
        type: "stopped",
        reason: "max_events",
        appliedEvents: 2,
        cursor: { streamId, afterSequence: "9" },
      });
      expect(lines.every((line) => line.schema === "sdar.task-business-probe-ndjson/v1")).toBe(
        true,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each(["fresh", "stale_context", "stale_cursor"] as const)(
    "hydrates a changed object without accepting a snapshot behind the stream (case=%s)",
    async (scenario) => {
      const routeRef = context.artifactRefs[0];
      if (!routeRef) throw new Error("CATALOG_ROUTE_REF_MISSING");
      const routeRef2 = { ...routeRef, revision: 2 };
      const context2 = TaskBusinessContextSchema.parse({
        ...context,
        contextRevision: 5,
        activeRefs: { ...context.activeRefs, route: routeRef2 },
        artifactRefs: [routeRef2],
        updatedAt: "2026-09-23T00:02:00Z",
      });
      const route2 = TaskArtifactSchema.parse({
        ...routeLine,
        revision: 2,
        identity: context.identity,
      });
      const requestedCursors: unknown[] = [];
      let snapshots = 0;
      const server = createServer((request, response) => {
        void (async () => {
          let raw = "";
          for await (const chunk of request) raw += String(chunk);
          const envelope = JSON.parse(raw) as {
            id: string;
            method: string;
            params: Record<string, unknown>;
          };
          response.setHeader("content-type", "application/json");
          if (envelope.method === "io.sdar/taskBusiness/context/get") {
            snapshots += 1;
            const latest = snapshots > 1 && scenario !== "stale_context";
            response.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: envelope.id,
                result: {
                  resultType: "complete",
                  profileVersion: "1.0-rc2",
                  snapshot: {
                    contextRevision: latest ? 5 : 4,
                    context: latest ? context2 : context,
                    objects: latest
                      ? [{ kind: "artifact", value: route2 }, ...snapshotObjects.slice(1)]
                      : snapshotObjects,
                    objectDescriptors: [],
                  },
                  resumeFrom: {
                    streamId,
                    afterSequence: snapshots > 1 && scenario !== "stale_cursor" ? "6" : "5",
                  },
                },
              }),
            );
            return;
          }
          expect(envelope.method).toBe("io.sdar/businessEvents/listen");
          const requested = envelope.params.cursor;
          requestedCursors.push(requested);
          const first = requestedCursors.length === 1;
          response.setHeader("content-type", "text/event-stream");
          const event = notification(first ? "6" : "7", "vehicle.business", taskId, first ? 1 : 0);
          event.params.rawPayload = first
            ? {
                schemaVersion: "sdar.task-business-feedback/1.0-rc2",
                kind: "ARTIFACT_CHANGED",
                contextRevision: 5,
                providerRecordedAt: "2026-09-23T00:02:00Z",
                payload: { change: "update", artifactRef: routeRef2, reasonCode: "ROUTE_UPDATED" },
              }
            : {
                schemaVersion: "sdar.task-business-feedback/1.0-rc2",
                kind: "BUSINESS_EVENT",
                contextRevision: 6,
                providerRecordedAt: "2026-09-23T00:03:00Z",
                payload: {
                  eventType: "test.observed",
                  severity: "info",
                  reasonCode: "OBSERVED",
                  description: "Observed after snapshot refresh",
                },
              };
          response.end(
            sse({
              jsonrpc: "2.0",
              method: "notifications/io.sdar/businessEvents/acknowledged",
              params: {
                streamId,
                acceptedAfterSequence: first ? "5" : "6",
              },
            }) + sse(event),
          );
        })().catch((error: unknown) => response.destroy(error as Error));
      });
      const port = await new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string") reject(new Error("HTTP_BIND_FAILED"));
          else resolve(address.port);
        });
      });
      try {
        const lines: Record<string, unknown>[] = [];
        const run = runReadOnlyTaskBusinessProbe({
          mcpUrl: `http://127.0.0.1:${port}/mcp`,
          taskId,
          maxEvents: 2,
          durationMs: 2_000,
          emit: (line) => {
            lines.push(line);
          },
        });
        if (scenario !== "fresh") {
          await expect(run).rejects.toThrow("BUSINESS_SNAPSHOT_BEHIND_STREAM");
          expect(snapshots).toBe(2);
          expect(requestedCursors).toEqual([{ streamId, afterSequence: "5" }]);
          expect(nonObjectLines(lines).map((line) => line.type)).toEqual([
            "snapshot",
            "businessEvent",
            "cursor",
            "refresh",
            "error",
            "stopped",
          ]);
          expect(lines.filter((line) => line.type === "businessObject")).toHaveLength(4);
          return;
        }
        await run;
        expect(snapshots).toBe(2);
        expect(requestedCursors).toEqual([
          { streamId, afterSequence: "5" },
          { streamId, afterSequence: "6" },
        ]);
        expect(nonObjectLines(lines).map((line) => line.type)).toEqual([
          "snapshot",
          "businessEvent",
          "cursor",
          "refresh",
          "snapshot",
          "businessEvent",
          "cursor",
          "stopped",
        ]);
        expect(nonObjectLines(lines)[1]).toMatchObject({
          kind: "ARTIFACT_CHANGED",
          unresolvedRefs: [routeRef2],
        });
        expect(nonObjectLines(lines)[4]).toMatchObject({
          contextRevision: 5,
          resumeFrom: { streamId, afterSequence: "6" },
          unresolvedRefs: [],
        });
        const businessObjects = lines.filter((line) => line.type === "businessObject");
        expect(businessObjects).toHaveLength(8);
        expect(businessObjects.at(-4)).toMatchObject({
          contextRevision: 5,
          resumeFrom: { streamId, afterSequence: "6" },
          object: { kind: "artifact", value: { artifactId: routeRef.id, revision: 2 } },
        });
        expect(lines.at(-1)).toMatchObject({
          appliedEvents: 2,
          cursor: { streamId, afterSequence: "7" },
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
