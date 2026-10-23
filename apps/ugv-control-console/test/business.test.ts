import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { Mcp } from "../server/mcp.js";
import { businessSnapshot, readChunks } from "../server/business.js";
const bytes = Buffer.from(JSON.stringify({ hello: "证据" })),
  sha = createHash("sha256").update(bytes).digest("hex");
describe("bounded immutable business reads", () => {
  it("assembles and verifies content", async () => {
    expect(
      await readChunks(async (offset) => ({
        encoding: "base64",
        offset,
        totalBytes: String(bytes.length),
        bytes: bytes.subarray(offset, offset + 5).toString("base64"),
        sha256: sha,
        ...(offset + 5 < bytes.length ? { nextOffset: String(offset + 5) } : {}),
      })),
    ).toEqual(bytes);
  });
  it("rejects checksum and offset conflicts", async () => {
    await expect(
      readChunks(async () => ({
        encoding: "base64",
        offset: 0,
        totalBytes: String(bytes.length),
        bytes: bytes.toString("base64"),
        sha256: "0".repeat(64),
      })),
    ).rejects.toThrow("DIGEST");
    await expect(
      readChunks(async () => ({
        encoding: "base64",
        offset: 5,
        totalBytes: String(bytes.length),
        bytes: bytes.toString("base64"),
        sha256: sha,
      })),
    ).rejects.toThrow("CHUNK");
  });
  it("handles exact descriptors and refuses foreign task objects", async () => {
    const identity = {
      taskId: "t",
      executionId: "e",
      providerId: "p",
      resourceId: "v",
      operationName: "vehicle_inspect_area",
      simulationId: null,
    };
    const context = {
      identity,
      contextRevision: 1,
      artifactRefs: [{ kind: "artifact", id: "a", revision: 1 }],
    };
    let foreign = false;
    const mcp = new Mcp(
      "http://fixture/mcp",
      {},
      async () =>
        new Response(
          JSON.stringify({
            result: {
              snapshot: {
                contextRevision: 1,
                context,
                objects: [
                  {
                    kind: "artifact",
                    value: {
                      artifactId: "a",
                      revision: 1,
                      identity: foreign ? { ...identity, taskId: "wrong" } : identity,
                    },
                  },
                ],
                objectDescriptors: [],
              },
              resumeFrom: { streamId: "s", afterSequence: "1" },
            },
          }),
        ),
    );
    expect((await businessSnapshot(mcp, "t")).complete).toBe(true);
    foreign = true;
    await expect(businessSnapshot(mcp, "t")).rejects.toThrow("IDENTITY");
  });
  it("rejects a transport redirect and does not switch upstreams", async () => {
    let options: RequestInit | undefined;
    const mcp = new Mcp("http://fixture/mcp", {}, async (_url, init) => {
      options = init;
      throw Error("network");
    });
    await expect(mcp.rpc("server/discover")).rejects.toMatchObject({ uncertain: true });
    expect(options?.redirect).toBe("error");
  });
});

describe("large snapshots and immutable revisions", () => {
  it("assembles descriptor objects across pages without truncating findings", async () => {
    const identity = {
      taskId: "large",
      executionId: "execution",
      providerId: "provider",
      resourceId: "vehicle:ugv",
      operationName: "vehicle_inspect_area",
    };
    const object = {
      kind: "artifact",
      value: {
        identity,
        artifactId: "report",
        revision: 2,
        properties: { data: { findings: Array.from({ length: 300 }, (_, i) => ({ id: i })) } },
      },
    };
    const encoded = Buffer.from(JSON.stringify(object)),
      digest = createHash("sha256").update(encoded).digest("hex");
    const context = {
      identity,
      contextRevision: 2,
      artifactRefs: [{ kind: "artifact", id: "report", revision: 2 }],
    };
    let pages = 0;
    const mcp = new Mcp("http://isolated/mcp", {}, async (_url, options) => {
      const request = JSON.parse(typeof options?.body === "string" ? options.body : "{}") as {
        method: string;
        params: Record<string, unknown>;
      };
      if (request.method === "io.sdar/taskBusiness/snapshotParts/get") {
        const offset = Number(request.params.offset),
          chunk = encoded.subarray(offset, offset + 256);
        return new Response(
          JSON.stringify({
            result: {
              part: {
                encoding: "base64",
                offset,
                totalBytes: String(encoded.length),
                sha256: digest,
                bytes: chunk.toString("base64"),
                ...(offset + chunk.length < encoded.length
                  ? { nextOffset: String(offset + chunk.length) }
                  : {}),
              },
            },
          }),
        );
      }
      const second = !!request.params.pageCursor;
      pages++;
      return new Response(
        JSON.stringify({
          result: {
            snapshot: {
              contextRevision: 2,
              context,
              objects: [],
              objectDescriptors: second
                ? [
                    {
                      ref: { kind: "artifact", id: "report", revision: 2 },
                      readMethod: "getObjectVersion",
                      sizeBytes: encoded.length,
                    },
                  ]
                : [],
              ...(!second ? { nextCursor: "page-2" } : {}),
            },
            snapshotToken: "fixed-token",
            resumeFrom: { streamId: "stream", afterSequence: "4" },
          },
        }),
      );
    });
    const snapshot = await businessSnapshot(mcp, "large");
    expect(snapshot.complete).toBe(true);
    expect(pages).toBe(2);
    expect(snapshot.objects).toEqual([object]);
  });
});
