import { requireContract } from "./error.js";
import {
  decodeChassisFrame as decodeV20,
  encodeChassisFrame as encodeV20,
  crc16CcittFalse,
  type ChassisFrame as V20Frame,
} from "./chassis.js";

export type ChassisProtocolVersion = "2.0" | "2.1";
export type ChassisFrame = Omit<V20Frame, "protocolVersion"> & {
  protocolVersion: ChassisProtocolVersion;
};

/** Explicit wire version; the frozen 2.0 decoder remains the business-payload authority. */
export function decodeChassisFrame(
  frame: Buffer,
  expected: {
    systemId?: string;
    targetSystemId?: string;
    protocolVersion?: ChassisProtocolVersion;
  } = {},
): ChassisFrame {
  if ((expected.protocolVersion ?? "2.0") === "2.0") return decodeV20(frame, expected);
  requireContract(frame.length <= 65_535 + 24 + 18, "ZMQ_BINARY_FRAME_TOO_LARGE");
  const separator = frame.indexOf(0x3a);
  requireContract(
    separator > 0 && separator <= 17 && frame.length >= separator + 30,
    "ZMQ_BINARY_HEADER_INVALID",
  );
  const start = separator + 1,
    header = Buffer.from(frame.subarray(start, start + 24));
  const wire = frame.subarray(start + 24);
  requireContract(header.readUInt16LE(20) === wire.length, "ZMQ_BINARY_PAYLOAD_LENGTH_INVALID");
  requireContract(crc16CcittFalse(wire) === header.readUInt16LE(22), "ZMQ_BINARY_CRC_INVALID");
  requireContract(wire.length >= 5, "ZMQ_BINARY_STRING_PREFIX_INVALID");
  requireContract(wire.readUInt32LE(0) === wire.length - 4, "ZMQ_BINARY_STRING_LENGTH_INVALID");
  const payload = wire.subarray(4);
  header.writeUInt16LE(payload.length, 20);
  header.writeUInt16LE(crc16CcittFalse(payload), 22);
  const parsed = decodeV20(Buffer.concat([frame.subarray(0, start), header, payload]), expected);
  return { ...parsed, protocolVersion: "2.1", payloadBytes: wire.length };
}

export function encodeChassisFrame(
  input: Parameters<typeof encodeV20>[0] & {
    protocolVersion?: ChassisProtocolVersion;
  },
): Buffer {
  if ((input.protocolVersion ?? "2.0") === "2.0") return encodeV20(input);
  requireContract(
    input.payload.length > 0 && input.payload.length <= 65_531,
    "ZMQ_BINARY_PAYLOAD_LENGTH_INVALID",
  );
  const legacy = encodeV20(input),
    start = legacy.indexOf(0x3a) + 1;
  const header = Buffer.from(legacy.subarray(start, start + 24));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(input.payload.length);
  const wire = Buffer.concat([prefix, input.payload]);
  header.writeUInt16LE(wire.length, 20);
  header.writeUInt16LE(crc16CcittFalse(wire), 22);
  return Buffer.concat([legacy.subarray(0, start), header, wire]);
}
