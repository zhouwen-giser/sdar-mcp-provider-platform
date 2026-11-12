import { requireContract } from "./error.js";
import { decodeChassisFrame as decodeBusiness } from "./chassis.js";
import { decodeChassisFrame, type ChassisFrame } from "./chassis-versioned.js";

export const CHASSIS_SITE_PUBLICATION = "prefix_business_length_crc" as const;
export type ChassisPublicationFraming = "prefix_wire_length_crc" | typeof CHASSIS_SITE_PUBLICATION;

/** Explicit site receive contract. Never retry another decoder after a failure. */
export function decodeChassisPublication(
  frame: Buffer,
  expected: Parameters<typeof decodeChassisFrame>[1] & {
    publicationFraming?: ChassisPublicationFraming;
  } = {},
): ChassisFrame {
  if (expected.publicationFraming !== CHASSIS_SITE_PUBLICATION)
    return decodeChassisFrame(frame, expected);
  requireContract(expected.protocolVersion === "2.1", "ZMQ_SITE_FRAMING_VERSION_INVALID");
  requireContract(frame.length <= 65535 + 24 + 18, "ZMQ_BINARY_FRAME_TOO_LARGE");
  const separator = frame.indexOf(0x3a),
    start = separator + 1;
  requireContract(
    separator > 0 && separator <= 17 && frame.length >= start + 29,
    "ZMQ_BINARY_HEADER_INVALID",
  );
  const header = frame.subarray(start, start + 24),
    wire = frame.subarray(start + 24);
  requireContract(wire.length <= 65535, "ZMQ_BINARY_PAYLOAD_LENGTH_INVALID");
  requireContract(wire.length >= 5, "ZMQ_BINARY_STRING_PREFIX_INVALID");
  requireContract(wire.readUInt32LE(0) === wire.length - 4, "ZMQ_BINARY_STRING_LENGTH_INVALID");
  requireContract(header.readUInt16LE(20) === wire.length - 4, "ZMQ_SITE_BUSINESS_LENGTH_INVALID");
  // The frozen business decoder checks CRC, topic, IDs and every business field.
  const parsed = decodeBusiness(
    Buffer.concat([frame.subarray(0, start + 24), wire.subarray(4)]),
    expected,
  );
  return { ...parsed, protocolVersion: "2.1", payloadBytes: wire.length };
}
