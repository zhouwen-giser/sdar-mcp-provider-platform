import { randomUUID, createHash } from "node:crypto";
import { Reply } from "zeromq";
import jpeg from "jpeg-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FrameSettings,
  FrameService,
  NativeFrameClient,
  FrameObservationIndex,
  validateJpeg,
} from "../../packages/vehicle-zmq-frames/src/index.js";
import { ObservationNormalizer } from "../../packages/vehicle-zmq-observer/src/normalize.js";
import { ObservationState } from "../../packages/vehicle-zmq-observer/src/state.js";
import { DeploymentProfileV2 } from "../../packages/vehicle-zmq-contract/src/site-profile.js";
import { clock, profile, settings, scope } from "../ugv-zmq-observer/helpers.js";
const metadata = {
  camera_id: "eo",
  frame_id: "frame-1",
  width_px: 20,
  height_px: 15,
  exposure_utc_ms: null,
};
const bytes = jpeg.encode({ width: 20, height: 15, data: Buffer.alloc(20 * 15 * 4, 127) }, 80).data;
const hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");
const config = FrameSettings.parse({});
const context = {
  authorizationContextHash: "a".repeat(64),
  executionMode: "live",
  simulationId: "",
  correlationId: "test",
};
const newProfile = () => {
  const p = profile();
  return DeploymentProfileV2.parse({
    ...p,
    schemaVersion: "ugv.zmq-deployment/2",
    components: {
      ...p.components,
      chassis: { ...p.components.chassis, protocolVersion: "2.1" },
      eo: { ...p.components.eo, protocolVersion: "2.3", framePullEndpoint: "tcp://127.0.0.1:5559" },
    },
  });
};
function reference(index: FrameObservationIndex, frameId = "frame-1", sessionId = randomUUID()) {
  const m = { ...metadata, frame_id: frameId },
    utc = 1794384104308;
  const n = new ObservationNormalizer(newProfile(), settings());
  const r = n.receive(
    "eo",
    [
      Buffer.from("isr/isr-01/frame_header"),
      Buffer.from(
        JSON.stringify({
          protocol: "2.3",
          kind: "event",
          device_id: "isr-01",
          topic: "frame_header",
          published_at_utc_ms: utc,
          data: m,
        }),
      ),
    ],
    clock(1, utc),
  );
  expect(r.projectable).toBe(true);
  index.observe(r, sessionId);
  return r;
}
const sockets: Reply[] = [],
  clients: NativeFrameClient[] = [];
const services: FrameService[] = [];
afterEach(() => {
  services.splice(0).forEach((s) => s.close());
  clients.splice(0).forEach((c) => c.close());
  sockets.splice(0).forEach((s) => s.close());
  vi.restoreAllMocks();
});
async function endpoint(
  change: (
    request: Record<string, unknown>,
    reply: Record<string, unknown>,
  ) => Buffer[] | undefined,
) {
  const socket = new Reply({ linger: 0 });
  sockets.push(socket);
  await socket.bind("tcp://127.0.0.1:*");
  const client = new NativeFrameClient(
    socket.lastEndpoint!,
    "isr-01",
    FrameSettings.parse({ receiveTimeoutMs: 100 }),
  );
  clients.push(client);
  const work = (async () => {
    const f = await socket.receive(),
      request = JSON.parse(f[0]!.toString()) as Record<string, unknown>;
    const reply = {
      protocol: "2.3",
      kind: "response",
      device_id: "isr-01",
      response_id: request.request_id,
      method: "FramePull",
      ok: true,
      error: null,
      result: { ...metadata, encoding: "jpeg", byte_length: bytes.length },
    };
    const response = change(request, reply);
    if (response) await socket.send(response);
  })();
  return { client, work };
}
const json = (v: unknown) => Buffer.from(JSON.stringify(v));
describe("bounded exact FramePull", () => {
  it("decodes real JPEG pixels and checks actual dimensions", async () => {
    await expect(validateJpeg(bytes, 20, 15)).resolves.toBeUndefined();
    await expect(validateJpeg(bytes, 21, 15)).rejects.toThrow("DIMENSIONS_INVALID");
    await expect(validateJpeg(Buffer.from([255, 216, 255, 217]), 20, 15)).rejects.toThrow("JPEG");
  });
  it("reads only the requested camera and frame with request correlation", async () => {
    const { client, work } = await endpoint((request, reply) => {
      expect(request.params).toEqual({ camera_id: "eo", frame_id: "frame-1" });
      return [json(reply), bytes];
    });
    expect((await client.pull("eo", "frame-1")).bytes).toEqual(bytes);
    await work;
  });
  it.each(["response_id", "device_id", "frame", "size", "multipart", "jpeg"])(
    "rejects invalid response %s",
    async (kind) => {
      const { client, work } = await endpoint((_request, reply) => {
        if (kind === "response_id") reply.response_id = "other";
        if (kind === "device_id") reply.device_id = "other";
        if (kind === "frame") (reply.result as Record<string, unknown>).frame_id = "other";
        if (kind === "size")
          (reply.result as Record<string, unknown>).byte_length = bytes.length + 1;
        if (kind === "multipart") return [json(reply), bytes, bytes];
        if (kind === "jpeg") return [json(reply), Buffer.alloc(bytes.length)];
        return [json(reply), bytes];
      });
      await expect(client.pull("eo", "frame-1")).rejects.toThrow("ZMQ_FRAME_");
      await work;
    },
  );
  it.each([
    ["FRAME_UNAVAILABLE", "EVICTED"],
    ["NOT_FOUND", "CAMERA_NOT_FOUND"],
  ])("distinguishes native %s", async (code, expected) => {
    const { client, work } = await endpoint((_request, reply) => [
      json({ ...reply, ok: false, result: null, error: { code, message: "not available" } }),
    ]);
    await expect(client.pull("eo", "frame-1")).rejects.toThrow(expected);
    await work;
  });
  it("closes a pending image exchange without keeping a socket or decoder alive", async () => {
    const { client, work } = await endpoint(() => undefined);
    const pull = client.pull("eo", "frame-1");
    const rejected = expect(pull).rejects.toThrow("CLIENT_CLOSED");
    await work;
    client.close();
    await rejected;
  });
  it("bounds timeout and refuses a parallel pull without delaying event-loop work", async () => {
    const { client, work } = await endpoint(() => undefined);
    const pull = client.pull("eo", "frame-1");
    await expect(client.pull("eo", "frame-1")).rejects.toThrow("CHANNEL_BUSY");
    let supervised = false;
    setTimeout(() => {
      supervised = true;
    }, 10);
    await expect(pull).rejects.toThrow("RECEIVE_TIMEOUT");
    expect(supervised).toBe(true);
    await work;
  });
});

describe("frame ownership, cache and metadata audit", () => {
  function rig() {
    let now = 0;
    const index = new FrameObservationIndex(() => now);
    reference(index);
    const client = new NativeFrameClient("tcp://127.0.0.1:1", "isr-01", config);
    clients.push(client);
    const pull = vi.spyOn(client, "pull").mockResolvedValue({
      bytes,
      metadata: { ...metadata, encoding: "jpeg", byte_length: bytes.length },
    });
    const audit: Record<string, unknown>[] = [];
    const service = new FrameService(
      "vehicle:ugv",
      client,
      index,
      config,
      async (record) => {
        audit.push(record);
      },
      () => now,
    );
    services.push(service);
    return {
      service,
      index,
      pull,
      audit,
      advance: (v: number) => {
        now = v;
      },
    };
  }
  it("chunks contiguously with full/chunk hashes and stores metadata only", async () => {
    const r = rig(),
      parts: Buffer[] = [];
    let data = await r.service.read(
      { resourceId: "vehicle:ugv", cameraId: "eo", frameId: "frame-1", maxBytes: 100 },
      context,
    );
    const id = data.retrievalId;
    parts.push(Buffer.from(data.dataBase64, "base64"));
    while (data.nextOffset !== null) {
      data = await r.service.read(
        { resourceId: "vehicle:ugv", retrievalId: id, offset: data.nextOffset, maxBytes: 100 },
        context,
      );
      parts.push(Buffer.from(data.dataBase64, "base64"));
    }
    expect(Buffer.concat(parts)).toEqual(bytes);
    expect(data.sha256).toBe(hash(bytes));
    expect(r.pull).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r.audit)).not.toContain("dataBase64");
    expect(JSON.stringify(r.audit)).not.toContain(bytes.toString("base64"));
    expect(data.diagnostics).toContain("EXPOSURE_UTC_UNKNOWN");
  });
  it("binds reads to auth/mode/resource and never falls back to a newer frame", async () => {
    const r = rig(),
      a = await r.service.read(
        { resourceId: "vehicle:ugv", cameraId: "eo", frameId: "frame-1" },
        context,
      );
    for (const bad of [
      { ...context, authorizationContextHash: "b".repeat(64) },
      { ...context, executionMode: "simulation", simulationId: "s" },
    ])
      await expect(
        r.service.read({ resourceId: "vehicle:ugv", retrievalId: a.retrievalId, offset: 0 }, bad),
      ).rejects.toThrow("EXPIRED_OR_UNAUTHORIZED");
    await expect(
      r.service.read(
        { resourceId: "vehicle:other", retrievalId: a.retrievalId, offset: 0 },
        context,
      ),
    ).rejects.toThrow("RESOURCE_UNAUTHORIZED");
    r.advance(300001);
    await expect(
      r.service.read({ resourceId: "vehicle:ugv", retrievalId: a.retrievalId, offset: 0 }, context),
    ).rejects.toThrow("EXPIRED_OR_UNAUTHORIZED");
    expect(r.service.usage.bytes).toBe(0);
    expect(r.pull).toHaveBeenCalledTimes(1);
  });
  it("removes expired image bytes without requiring another read", async () => {
    const r = rig();
    await r.service.read(
      { resourceId: "vehicle:ugv", cameraId: "eo", frameId: "frame-1" },
      context,
    );
    expect(r.service.usage.bytes).toBeGreaterThan(0);
    r.advance(300001);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(r.service.usage.bytes).toBe(0);
  });
  it("limits simultaneous chunk readers and refuses unaudited image delivery", async () => {
    const r = rig(),
      first = await r.service.read(
        { resourceId: "vehicle:ugv", cameraId: "eo", frameId: "frame-1" },
        context,
      );
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const audit = vi.spyOn(r.service, "audit").mockImplementation(() => gate);
    const reads = Array.from({ length: 8 }, () =>
      r.service.read(
        { resourceId: "vehicle:ugv", retrievalId: first.retrievalId, offset: 0 },
        context,
      ),
    );
    await expect(
      r.service.read(
        { resourceId: "vehicle:ugv", retrievalId: first.retrievalId, offset: 0 },
        context,
      ),
    ).rejects.toThrow("CHANNEL_BUSY");
    release();
    await Promise.all(reads);
    audit.mockRejectedValue(Error("database unavailable"));
    await expect(
      r.service.read(
        { resourceId: "vehicle:ugv", retrievalId: first.retrievalId, offset: 0 },
        context,
      ),
    ).rejects.toThrow("AUDIT_UNAVAILABLE");
  });
  it("bounds image bytes and entry count with explicit early eviction", async () => {
    const r = rig();
    const maxBytes = 16777216,
      large = Buffer.alloc(10 * 1024 * 1024);
    r.pull.mockResolvedValue({
      bytes: large,
      metadata: { ...metadata, encoding: "jpeg", byte_length: large.length },
    });
    const service = new FrameService(
      "vehicle:ugv",
      r.service.client,
      r.index,
      { ...config, cacheMaxBytes: maxBytes },
      async () => {},
    );
    const a = await service.read(
      { resourceId: "vehicle:ugv", cameraId: "eo", frameId: "frame-1" },
      context,
    );
    reference(r.index, "frame-2");
    r.pull.mockResolvedValue({
      bytes: large,
      metadata: { ...metadata, frame_id: "frame-2", encoding: "jpeg", byte_length: large.length },
    });
    await service.read({ resourceId: "vehicle:ugv", cameraId: "eo", frameId: "frame-2" }, context);
    expect(service.usage.bytes).toBeLessThanOrEqual(maxBytes);
    await expect(
      service.read({ resourceId: "vehicle:ugv", retrievalId: a.retrievalId, offset: 0 }, context),
    ).rejects.toThrow("EXPIRED_OR_UNAUTHORIZED");
    service.close();
  });
  it("does not use frame headers as component heartbeat, target reports or empty evidence", () => {
    const r = rig(),
      p = newProfile(),
      s = settings(),
      state = new ObservationState(scope(), s),
      receipt = reference(r.index, "frame-3");
    state.apply({
      ...clock(),
      schemaVersion: "ugv.zmq-observation-event/2.0",
      eventId: randomUUID(),
      type: "transport",
      component: "eo",
      state: "connected",
    });
    state.apply(receipt);
    const snapshot = state.snapshot(
      randomUUID(),
      {
        status: "running",
        pendingRecords: 0,
        pendingBytes: 0,
        committedEvents: 1,
        receivedMessages: 1,
        committedReceptions: 1,
        unconfirmedReceptions: 0,
        locallyDiscardedMessages: 0,
        failureCode: null,
        failureRecorded: null,
      },
      1000001n,
    );
    expect(p.components.eo.protocolVersion).toBe("2.3");
    expect(snapshot.channels.eo.receiptFresh).toBe(false);
    expect(snapshot.diagnostics).toContain("TARGET_REPORT_NOT_OBSERVED");
    expect(snapshot.observations).toHaveLength(1);
  });
});
