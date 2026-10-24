import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  DeploymentProfile,
  PassiveCapture,
  crc16CcittFalse,
  decodeChassisFrame,
} from "../../packages/vehicle-zmq-contract/src/index.js";
import {
  archiveEntryHash,
  observerIdentity,
  ObserverSettings,
  type ArchiveEntry,
  type ArchiveSession,
  type ClockStamp,
  type Component,
  type ObservationArchive,
  type ObservationEvent,
} from "../../packages/vehicle-zmq-observer/src/index.js";

export const profile = () =>
  DeploymentProfile.parse(
    JSON.parse(readFileSync("deploy/ugv-zmq/deployment.candidate.json", "utf8")) as unknown,
  );
export const settings = (override: Partial<ObserverSettings> = {}) =>
  ObserverSettings.parse({
    schemaVersion: "ugv.zmq-observer-settings/1",
    diagnosticPartition: "SIMULATED-test",
    ...override,
  });
export const scope = (p = profile(), partition = "SIMULATED-test") =>
  observerIdentity(p, partition, "a".repeat(64), "b".repeat(64));
export const clock = (n = 1, utc = 1792800000000): ClockStamp => ({
  receivedAt: new Date(utc).toISOString(),
  monotonicNs: String(n * 1_000_000),
  clockId: "SIMULATED-clock",
});
const capture = PassiveCapture.parse(
  JSON.parse(
    readFileSync("reports/ugv-zmq-phase1/raw/passive-publications-20261023.json", "utf8"),
  ) as unknown,
);
export function sourceFrames(component: Component, key?: string): Buffer[] {
  const record = capture.records.find((r) => r.component === component);
  const sample = record?.samples.find((s) => {
    const frames = s.frames.map((f) => Buffer.from(f.base64, "base64"));
    return (
      !key ||
      (component === "chassis"
        ? decodeChassisFrame(frames[0] ?? Buffer.alloc(0)).body.type === key
        : frames[0]?.toString().endsWith("/" + key))
    );
  });
  if (!sample) throw Error("TEST_SOURCE_SAMPLE_MISSING");
  return sample.frames.map((f) => Buffer.from(f.base64, "base64"));
}
export function jsonFrames(
  component: "eo" | "simulationEffect",
  topic = "device_status",
  utc = 1792800000000,
  data?: unknown,
): Buffer[] {
  const frames = sourceFrames(component, topic);
  const event = JSON.parse(frames[1]?.toString() ?? "{}") as Record<string, unknown>;
  event.published_at_utc_ms = utc;
  if (data !== undefined) event.data = data;
  return [frames[0] ?? Buffer.alloc(0), Buffer.from(JSON.stringify(event))];
}
export function eoFrames(topic: string, data: unknown, utc = 1792800000000): Buffer[] {
  return [
    Buffer.from(`isr/isr-01/${topic}`),
    Buffer.from(
      JSON.stringify({
        protocol: "2.2",
        kind: "event",
        device_id: "isr-01",
        topic,
        published_at_utc_ms: utc,
        data,
      }),
    ),
  ];
}
export const emptyReport = (extra: Record<string, unknown> = {}) => ({
  task_id: "native-task",
  observed_at_utc_ms: null,
  image: { camera_id: "camera-1", frame_id: "frame-1", width_px: 1920, height_px: 1080 },
  data_origin: "simulated",
  truncated: false,
  targets: [],
  ...extra,
});
export function localization(time = 1n): Buffer[] {
  const frame = sourceFrames("chassis", "localization"),
    bytes = Buffer.from(frame[0] ?? Buffer.alloc(0)),
    header = bytes.indexOf(0x3a) + 1;
  bytes.writeBigUInt64LE(time, header + 24);
  bytes.writeUInt16LE(crc16CcittFalse(bytes.subarray(header + 24)), header + 22);
  return [bytes];
}
export class MemoryArchive implements ObservationArchive {
  readonly entries: ArchiveEntry[] = [];
  readonly session: ArchiveSession = {
    sessionId: randomUUID(),
    partitionHash: "a".repeat(64),
    startedAt: new Date().toISOString(),
    genesisHash: "b".repeat(64),
  };
  failures: { code: string; lost: number }[] = [];
  closed = false;
  appendCalls = 0;
  gate: Promise<void> | undefined;
  failAppend = false;
  ackLost = false;
  failureWriteFails = false;
  async start() {
    return this.session;
  }
  async append(events: readonly ObservationEvent[]) {
    this.appendCalls++;
    if (this.gate) await this.gate;
    if (this.failAppend) throw Error("ZMQ_ARCHIVE_TEST_FAILURE");
    const entries = events.map((payload) => {
      const ordinal = String(this.entries.length + 1),
        previousHash = this.entries.at(-1)?.entryHash ?? this.session.genesisHash;
      const entry = {
        ordinal,
        previousHash,
        entryHash: archiveEntryHash(previousHash, ordinal, payload),
        payload,
      };
      this.entries.push(entry);
      return entry;
    });
    if (this.ackLost) throw Error("ZMQ_ARCHIVE_WRITE_UNCONFIRMED");
    return entries;
  }
  async fail(code: string, lost: number) {
    if (this.failureWriteFails) throw Error("UNAVAILABLE");
    this.failures.push({ code, lost });
  }
  async close() {
    this.closed = true;
  }
}
