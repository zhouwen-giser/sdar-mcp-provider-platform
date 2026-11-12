import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  decodeChassisFrame,
  encodeChassisFrame,
} from "../../packages/vehicle-zmq-contract/src/chassis-versioned.js";
import { crc16CcittFalse } from "../../packages/vehicle-zmq-contract/src/chassis.js";
import {
  EoPublicationV23,
  EoRequestV23,
  FramePullResponse,
} from "../../packages/vehicle-zmq-contract/src/schema-v23.js";
import { parsePublication } from "../../packages/vehicle-zmq-contract/src/wire-versioned.js";
import { checkContracts } from "../../scripts/ugv-zmq/check-contracts.js";

const fixtures = z
  .object({
    vectors: z.array(
      z.object({ name: z.string(), hex: z.string(), expected: z.record(z.string(), z.unknown()) }),
    ),
  })
  .parse(JSON.parse(readFileSync("contracts/ugv-zmq/v2/fixtures/chassis-reference.json", "utf8")));
const metadata = {
  camera_id: "eo",
  frame_id: "epoch-frame-1",
  width_px: 640,
  height_px: 480,
  exposure_utc_ms: null,
};
const event = (topic: string, data: unknown) => ({
  protocol: "2.3",
  kind: "event",
  device_id: "isr-01",
  published_at_utc_ms: 1794384104308,
  topic,
  data,
});
const track = () => ({
  task_id: "task-1",
  track_state: "tracking",
  track_id: "track-1",
  target_id: "target-1",
  observed_at_utc_ms: null,
  data_origin: "simulated",
  targets: [
    {
      image: { camera_id: "eo", frame_id: "epoch-frame-1", width_px: 640, height_px: 480 },
      pixel: { x_px: 10, y_px: 10 },
      bbox: { x_px: 5, y_px: 5, width_px: 20, height_px: 20 },
      observed_at_utc_ms: null as number | null,
      position: null,
      range_m: null,
      range_source: null,
      reason: "NOT_GEOLOCATED",
    },
  ],
});

describe("explicit native protocol generations", () => {
  it("keeps every frozen v1 source and contract hash", () =>
    expect(checkContracts().status).toBe("verified"));
  for (const f of fixtures.vectors)
    it(`independent Python 2.1 frame: ${f.name}`, () => {
      const bytes = Buffer.from(f.hex, "hex");
      expect(decodeChassisFrame(bytes, { protocolVersion: "2.1" })).toMatchObject(f.expected);
    });
  it("writes sender 0, target 1 and prefix-covered CRC identical to upstream", () => {
    const upstream = Buffer.from(
      readFileSync("contracts/ugv-zmq/v2/fixtures/upstream-mode.hex", "utf8").replace(/\s/g, ""),
      "hex",
    );
    const parsed = decodeChassisFrame(upstream, { protocolVersion: "2.1" });
    const payload = Buffer.alloc(4);
    payload.writeInt32LE(Number(parsed.body.value));
    expect(encodeChassisFrame({ ...parsed, payload, protocolVersion: "2.1" })).toEqual(upstream);
    const encoded = encodeChassisFrame({
      topic: "ad_remote_command",
      messageId: 1,
      systemId: "0",
      targetSystemId: "1",
      payload,
      protocolVersion: "2.1",
    });
    expect(decodeChassisFrame(encoded, { protocolVersion: "2.1" })).toMatchObject({
      systemId: "0",
      targetSystemId: "1",
      payloadBytes: 8,
    });
    expect(() => decodeChassisFrame(encoded)).toThrow();
  });
  it("rejects prefix/CRC corruption, truncation and overlong business payload", () => {
    const b = Buffer.from(fixtures.vectors[0]!.hex, "hex"),
      h = b.indexOf(0x3a) + 1;
    b.writeUInt32LE(0, h + 24);
    expect(() => decodeChassisFrame(b, { protocolVersion: "2.1" })).toThrow("CRC_INVALID");
    b.writeUInt16LE(crc16CcittFalse(b.subarray(h + 24)), h + 22);
    expect(() => decodeChassisFrame(b, { protocolVersion: "2.1" })).toThrow(
      "STRING_LENGTH_INVALID",
    );
    expect(() => decodeChassisFrame(b.subarray(0, -1), { protocolVersion: "2.1" })).toThrow();
    expect(() =>
      encodeChassisFrame({
        topic: "call_task",
        messageId: 11,
        systemId: "0",
        targetSystemId: "1",
        payload: Buffer.alloc(65532),
        protocolVersion: "2.1",
      }),
    ).toThrow("PAYLOAD_LENGTH_INVALID");
  });
  it("accepts nullable exposure without manufacturing UTC; rejects old/new cross interpretation", () => {
    const value = event("frame_header", metadata),
      frames = [Buffer.from("isr/isr-01/frame_header"), Buffer.from(JSON.stringify(value))];
    expect(EoPublicationV23.parse(value).data).toEqual(metadata);
    expect(parsePublication("eo", frames, "isr-01", "2.3").protocol).toBe("2.3");
    expect(() => parsePublication("eo", frames, "isr-01", "2.2")).toThrow();
    expect(() => parsePublication("eo", frames, "foreign", "2.3")).toThrow("FOREIGN_DEVICE");
  });
  it("strictly checks tracked bounds, pixel placement and report/target exposure", () => {
    expect(EoPublicationV23.safeParse(event("tracklist", track())).success).toBe(true);
    for (const mutation of ["exposure", "outside", "missing", "unknown"]) {
      const d = track(),
        t = d.targets[0]!;
      if (mutation === "exposure") t.observed_at_utc_ms = 1;
      if (mutation === "outside") t.bbox.x_px = 11;
      if (mutation === "missing") delete (t as Partial<typeof t>).bbox;
      if (mutation === "unknown") Object.assign(t, { latitude: 29 });
      expect(EoPublicationV23.safeParse(event("tracklist", d)).success).toBe(false);
    }
  });
  it("keeps finite tasks and excludes next_follow", () => {
    expect(
      EoRequestV23.safeParse({
        protocol: "2.3",
        kind: "request",
        device_id: "isr-01",
        request_id: "r",
        method: "TaskControl",
        params: { task_id: "t", action: "next_follow" },
      }).success,
    ).toBe(false);
  });
  it("validates FramePull success and nullable exposure", () => {
    const r = {
      protocol: "2.3",
      kind: "response",
      device_id: "isr-01",
      response_id: "r",
      method: "FramePull",
      ok: true,
      error: null,
      result: { ...metadata, encoding: "jpeg", byte_length: 53800 },
    };
    expect(FramePullResponse.safeParse(r).success).toBe(true);
    expect(FramePullResponse.safeParse({ ...r, command: null }).success).toBe(false);
  });
});
