import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  crc16CcittFalse,
  decodeChassisFrame,
  encodeChassisFrame,
} from "../../packages/vehicle-zmq-contract/src/index.js";

const fixtures = z
  .object({
    provenance: z.literal("constructed_reference_not_provider_confirmed"),
    vectors: z.array(
      z.object({
        name: z.string(),
        hex: z.string(),
        sha256: z.string(),
        expected: z.record(z.string(), z.unknown()),
      }),
    ),
  })
  .parse(
    JSON.parse(
      readFileSync("contracts/ugv-zmq/v1/fixtures/chassis-reference.json", "utf8"),
    ) as unknown,
  );
const vector = (name: string): Buffer => {
  const found = fixtures.vectors.find((v) => v.name === name);
  if (!found) throw Error("TEST_FIXTURE_MISSING");
  return Buffer.from(found.hex, "hex");
};
function reseal(frame: Buffer): Buffer {
  const start = frame.indexOf(0x3a) + 1;
  frame.writeUInt16LE(crc16CcittFalse(frame.subarray(start + 24)), start + 22);
  return frame;
}

describe("chassis v2 wire contract", () => {
  it("matches the independently specified CCITT-FALSE check vector", () => {
    expect(crc16CcittFalse(Buffer.from("123456789"))).toBe(0x29b1);
  });
  for (const fixture of fixtures.vectors)
    it(`decodes independent struct vector: ${fixture.name}`, () => {
      const bytes = Buffer.from(fixture.hex, "hex");
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
      expect(decodeChassisFrame(bytes)).toMatchObject(fixture.expected);
    });
  it("writes exact little-endian envelope bytes and uint64 identifiers", () => {
    expect(
      encodeChassisFrame({
        topic: "ad_remote_command",
        messageId: 1,
        systemId: "9007199254740993",
        targetSystemId: "18446744073709551615",
        payload: Buffer.from("03000000", "hex"),
      }),
    ).toEqual(vector("mode-target-point"));
    expect(() =>
      encodeChassisFrame({
        topic: "ad_remote_command",
        messageId: 1,
        systemId: "18446744073709551616",
        targetSystemId: "1",
        payload: Buffer.from("03000000", "hex"),
      }),
    ).toThrow("SYSTEM_ID_INVALID");
  });
  it("splits only the topic delimiter even when the payload contains a colon", () => {
    expect(decodeChassisFrame(vector("two-point-path")).body).toMatchObject({
      taskPoints: [{ reserved: 58 }, {}],
    });
  });
  it("rejects corrupted CRC, payload lengths and truncated headers", () => {
    const bytes = vector("two-point-path"),
      header = bytes.indexOf(0x3a) + 1;
    const corrupt = Buffer.from(bytes);
    corrupt[corrupt.length - 1] = 1;
    expect(() => decodeChassisFrame(corrupt)).toThrow("CRC_INVALID");
    const wrongLength = Buffer.from(bytes);
    wrongLength.writeUInt16LE(1, header + 20);
    expect(() => decodeChassisFrame(wrongLength)).toThrow("PAYLOAD_LENGTH_INVALID");
    expect(() => decodeChassisFrame(bytes.subarray(0, header + 23))).toThrow("HEADER_TRUNCATED");
  });
  it("rejects oversized vector counts before allocation", () => {
    const bytes = vector("two-point-path"),
      header = bytes.indexOf(0x3a) + 1;
    bytes.writeUInt32LE(0xffff_ffff, header + 24 + 4);
    expect(() => decodeChassisFrame(reseal(bytes))).toThrow("VECTOR_LENGTH_INVALID");
  });
  it("rejects nonfinite binary coordinates and trailing bytes", () => {
    const bytes = vector("two-point-path"),
      header = bytes.indexOf(0x3a) + 1;
    bytes.writeDoubleLE(Infinity, header + 24 + 8);
    expect(() => decodeChassisFrame(reseal(bytes))).toThrow("NONFINITE");
    const mode = vector("mode-target-point"),
      start = mode.indexOf(0x3a) + 1;
    const trailing = Buffer.concat([mode, Buffer.from([0])]);
    trailing.writeUInt16LE(5, start + 20);
    expect(() => decodeChassisFrame(reseal(trailing))).toThrow("TRAILING_BYTES");
  });
  it("enforces source identity and allows documented recipient broadcast", () => {
    const bytes = vector("two-point-path");
    expect(decodeChassisFrame(bytes, { systemId: "1", targetSystemId: "42" }).targetSystemId).toBe(
      "0",
    );
    expect(() => decodeChassisFrame(bytes, { systemId: "2" })).toThrow("FOREIGN_SYSTEM");
    expect(() => decodeChassisFrame(vector("mode-target-point"), { targetSystemId: "2" })).toThrow(
      "FOREIGN_RECIPIENT",
    );
  });
  it("rejects legacy one-byte feedback and unknown message IDs", () => {
    const original = vector("turnaround-feedback-v421"),
      start = original.indexOf(0x3a) + 1;
    const legacy = Buffer.from(original.subarray(0, start + 25));
    legacy.writeUInt16LE(1, start + 20);
    expect(() => decodeChassisFrame(reseal(legacy))).toThrow("TRUNCATED");
    const unknown = vector("two-point-path");
    unknown.writeUInt32LE(12, unknown.indexOf(0x3a) + 1);
    expect(() => decodeChassisFrame(unknown)).toThrow("MESSAGE_UNSUPPORTED");
  });
});
