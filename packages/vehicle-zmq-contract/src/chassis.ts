import { requireContract } from "./error.js";

export const CHASSIS_PROTOCOL_VERSION = "2.0";
const topics = ["ad_remote_command", "call_task", "ipc_message"] as const;
export type ChassisTopic = (typeof topics)[number];
export interface ChassisFrame {
  protocolVersion: "2.0";
  topic: ChassisTopic;
  messageId: number;
  systemId: string;
  targetSystemId: string;
  payloadBytes: number;
  body: Record<string, unknown>;
}

export function crc16CcittFalse(bytes: Buffer): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}

class Reader {
  offset = 0;
  constructor(readonly bytes: Buffer) {}
  take(size: number): number {
    requireContract(this.offset + size <= this.bytes.length, "ZMQ_BINARY_TRUNCATED");
    const begin = this.offset;
    this.offset += size;
    return begin;
  }
  u8(): number {
    return this.bytes.readUInt8(this.take(1));
  }
  u16(): number {
    return this.bytes.readUInt16LE(this.take(2));
  }
  u32(): number {
    return this.bytes.readUInt32LE(this.take(4));
  }
  i32(): number {
    return this.bytes.readInt32LE(this.take(4));
  }
  u64(): string {
    return this.bytes.readBigUInt64LE(this.take(8)).toString();
  }
  floating(size: 4 | 8): number {
    const begin = this.take(size);
    const value = size === 4 ? this.bytes.readFloatLE(begin) : this.bytes.readDoubleLE(begin);
    requireContract(Number.isFinite(value), "ZMQ_BINARY_NONFINITE_NUMBER");
    return value;
  }
  vector<T>(elementBytes: number, read: () => T): T[] {
    const count = this.u32();
    requireContract(
      count <= Math.floor((this.bytes.length - this.offset) / elementBytes),
      "ZMQ_BINARY_VECTOR_LENGTH_INVALID",
    );
    return Array.from({ length: count }, read);
  }
  end(): void {
    requireContract(this.offset === this.bytes.length, "ZMQ_BINARY_TRAILING_BYTES");
  }
}

const within = (value: number, min: number, max: number): number => {
  requireContract(value >= min && value <= max, "ZMQ_BINARY_VALUE_INVALID");
  return value;
};
const flag = (value: number): number => within(value, 0, 1);

function payload(topic: ChassisTopic, messageId: number, bytes: Buffer): Record<string, unknown> {
  const r = new Reader(bytes);
  let body: Record<string, unknown>;
  const points = () =>
    r.vector(29, () => ({
      latitude: within(r.floating(8), -90, 90),
      longitude: within(r.floating(8), -180, 180),
      headingAngle: r.floating(8),
      property: within(r.u8(), 1, 2),
      reserved: r.u32(),
    }));
  if (topic === "ad_remote_command") {
    switch (messageId) {
      case 1:
        body = { type: "mode", value: within(r.i32(), 0, 9) };
        break;
      case 2:
        body = { type: "motionControl", value: within(r.i32(), 1, 4) };
        break;
      case 3:
        body = { type: "speedLimit", metresPerSecond: within(r.floating(4), 0, Number.MAX_VALUE) };
        break;
      case 4:
        body = { type: "obstacleAvoidance", value: flag(r.u8()) };
        break;
      case 0x20:
        body = { type: "perceptionPriority", value: flag(r.u8()) };
        break;
      default:
        throw new Error("ZMQ_BINARY_MESSAGE_UNSUPPORTED");
    }
  } else if (topic === "call_task") {
    requireContract([0x0a, 0x0b, 0x0d].includes(messageId), "ZMQ_BINARY_MESSAGE_UNSUPPORTED");
    const missionId = r.u32();
    const returnType = messageId === 0x0d ? flag(r.u8()) : undefined;
    const taskPoints = points();
    requireContract(messageId === 0x0d || taskPoints.length > 0, "ZMQ_BINARY_TASK_POINTS_EMPTY");
    requireContract(
      taskPoints.every((p) => p.headingAngle === 0),
      "ZMQ_BINARY_HEADING_RESERVED",
    );
    body = {
      type: messageId === 0x0a ? "targetPoint" : messageId === 0x0b ? "pathFollow" : "returnHome",
      missionId,
      ...(returnType === undefined ? {} : { returnType }),
      taskPoints,
    };
  } else {
    switch (messageId) {
      case 0x10000000:
        body = {
          type: "missionState",
          missionId: r.u32(),
          missionType: within(r.u8(), 1, 9),
          state: within(r.u8(), 0, 5),
          progress: within(r.u8(), 0, 100),
        };
        break;
      case 0x10000001:
        body = {
          type: "systemState",
          runState: flag(r.u8()),
          mode: within(r.u8(), 0, 9),
          speedLimitMetresPerSecond: within(r.floating(4), 0, Number.MAX_VALUE),
          videoConfig: Array.from({ length: 6 }, () => r.u8()),
          errorCodes: r.vector(2, () => r.u16()),
        };
        break;
      case 0x10000002: {
        const timeUs = r.u64(),
          systemTimeUs = r.u64(),
          utcTimeUs = r.u64();
        const ahrsStatus = r.u8();
        const longitude = within(r.floating(8), -180, 180),
          latitude = within(r.floating(8), -90, 90),
          altitude = r.floating(8);
        const triple = () => Array.from({ length: 3 }, () => r.floating(8));
        body = {
          type: "localization",
          timeUs,
          systemTimeUs,
          utcTimeUs,
          timebase: "unconfirmed",
          ahrsStatus,
          longitude,
          latitude,
          altitude,
          velocityEnu: triple(),
          attitudeRaw: triple(),
          accelerationRaw: triple(),
          angularVelocityRaw: triple(),
          quaternion: Array.from({ length: 4 }, () => r.floating(8)),
          mercatorRaw: triple(),
          curvature: r.floating(8),
          fixType: within(r.u8(), 0, 3),
          fixQuality: within(r.u8(), 0, 6),
          alignmentMode: within(r.u8(), 0, 3),
        };
        break;
      }
      case 0x10000004:
        body = {
          type: "planningPath",
          points: r.vector(8, () => ({
            longitude: within(r.i32() / 1e7, -180, 180),
            latitude: within(r.i32() / 1e7, -90, 90),
          })),
          missionCorrelation: "not_provided",
        };
        break;
      case 0x10000020:
        body = {
          type: "performance",
          cpuUsage: r.floating(4),
          memoryUsage: r.floating(4),
          temperature: r.floating(4),
          uploadBytesPerSecond: r.floating(4),
          downloadBytesPerSecond: r.floating(4),
        };
        break;
      case 0x10000021:
        body = {
          type: "failsafe",
          faults: r.vector(9, () => ({
            faultType: within(r.u8(), 0, 2),
            faultLevel: within(r.i32(), 0, 3),
            errorCode: r.u32(),
          })),
        };
        break;
      case 0x10000024:
        body = { type: "perceptionPriority", value: flag(r.u8()) };
        break;
      case 0x10000028: {
        const status = within(r.u8(), 0, 2);
        const turnaroundPoints = r.vector(9, () => {
          const type = within(r.u8(), 0, 0),
            longitudeRaw = r.i32(),
            latitudeRaw = r.i32();
          const invalid = longitudeRaw === 181_000_000 || latitudeRaw === 181_000_000;
          return {
            type,
            longitudeRaw,
            latitudeRaw,
            position: invalid
              ? null
              : {
                  longitude: within(longitudeRaw / 1e6, -180, 180),
                  latitude: within(latitudeRaw / 1e6, -90, 90),
                },
          };
        });
        requireContract(
          status === 1 || turnaroundPoints.length === 0,
          "ZMQ_BINARY_TURNAROUND_STATE_INVALID",
        );
        body = {
          type: "missionFeedback",
          status,
          turnaroundPoints,
          missionCorrelation: "not_provided",
        };
        break;
      }
      default:
        throw new Error("ZMQ_BINARY_MESSAGE_UNSUPPORTED");
    }
  }
  r.end();
  return body;
}

export function decodeChassisFrame(
  frame: Buffer,
  expected: { systemId?: string; targetSystemId?: string } = {},
): ChassisFrame {
  requireContract(frame.length <= 65_535 + 24 + 18, "ZMQ_BINARY_FRAME_TOO_LARGE");
  const separator = frame.indexOf(0x3a);
  requireContract(separator >= 0 && separator <= 17, "ZMQ_BINARY_TOPIC_INVALID");
  const topic = frame.subarray(0, separator).toString("ascii");
  requireContract(
    topics.includes(topic as ChassisTopic) &&
      Buffer.from(topic, "ascii").equals(frame.subarray(0, separator)),
    "ZMQ_BINARY_TOPIC_INVALID",
  );
  const header = frame.subarray(separator + 1);
  requireContract(header.length >= 24, "ZMQ_BINARY_HEADER_TRUNCATED");
  const messageId = header.readUInt32LE(0),
    systemId = header.readBigUInt64LE(4).toString(),
    targetSystemId = header.readBigUInt64LE(12).toString();
  const length = header.readUInt16LE(20),
    checksum = header.readUInt16LE(22),
    bytes = header.subarray(24);
  requireContract(length > 0 && length === bytes.length, "ZMQ_BINARY_PAYLOAD_LENGTH_INVALID");
  requireContract(crc16CcittFalse(bytes) === checksum, "ZMQ_BINARY_CRC_INVALID");
  requireContract(
    expected.systemId === undefined || systemId === expected.systemId,
    "ZMQ_BINARY_FOREIGN_SYSTEM",
  );
  requireContract(
    expected.targetSystemId === undefined ||
      targetSystemId === expected.targetSystemId ||
      targetSystemId === "0",
    "ZMQ_BINARY_FOREIGN_RECIPIENT",
  );
  return {
    protocolVersion: "2.0",
    topic: topic as ChassisTopic,
    messageId,
    systemId,
    targetSystemId,
    payloadBytes: length,
    body: payload(topic as ChassisTopic, messageId, bytes),
  };
}

/** Wire framing only; this module never opens a socket or dispatches a command. */
export function encodeChassisFrame(input: {
  topic: ChassisTopic;
  messageId: number;
  systemId: string;
  targetSystemId: string;
  payload: Buffer;
}): Buffer {
  requireContract(
    Number.isInteger(input.messageId) && input.messageId >= 0 && input.messageId <= 0xffff_ffff,
    "ZMQ_BINARY_MESSAGE_ID_INVALID",
  );
  requireContract(
    input.payload.length > 0 && input.payload.length <= 65_535,
    "ZMQ_BINARY_PAYLOAD_LENGTH_INVALID",
  );
  const uint64 = (value: string) => {
    requireContract(
      /^(?:0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 0xffff_ffff_ffff_ffffn,
      "ZMQ_BINARY_SYSTEM_ID_INVALID",
    );
    return BigInt(value);
  };
  const header = Buffer.alloc(24);
  header.writeUInt32LE(input.messageId, 0);
  header.writeBigUInt64LE(uint64(input.systemId), 4);
  header.writeBigUInt64LE(uint64(input.targetSystemId), 12);
  header.writeUInt16LE(input.payload.length, 20);
  header.writeUInt16LE(crc16CcittFalse(input.payload), 22);
  const frame = Buffer.concat([Buffer.from(input.topic + ":", "ascii"), header, input.payload]);
  decodeChassisFrame(frame);
  return frame;
}
