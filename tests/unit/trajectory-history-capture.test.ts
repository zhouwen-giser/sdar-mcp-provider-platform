import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  VehicleMqttIngress,
  ugvMqttProfile,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";
import {
  captureTrajectoryReceipt,
  type ReceptionEntrance,
} from "../../packages/trajectory-history/src/capture.js";

function ingress() {
  return new VehicleMqttIngress(
    "ros_bridge_json",
    {
      maxPayloadBytes: 65536,
      maxDepth: 16,
      maxNodes: 4096,
      maxStringBytes: 16384,
    },
    ugvMqttProfile({
      providerId: "isr.vehicle.ugv.fixture",
      resourceId: "vehicle:a",
      entityId: "ugv1",
      vehicleType: "ugv",
      executionMode: "simulation",
    }),
  );
}
function entrance(): ReceptionEntrance {
  return {
    receptionId: randomUUID(),
    sessionId: randomUUID(),
    receivedUtc: "2026-10-12T01:02:03.004Z",
    monotonicNanoseconds: "12345",
    clockId: "SIMULATED-process-clock",
    qos: 1,
    packetId: 7,
    duplicateDeliveryHint: false,
    retainedDelivery: false,
  };
}
const payload = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("trajectory raw reception evidence", () => {
  it("preserves uncalibrated microseconds and rejects unsafe numeric clock precision", () => {
    const receiver = ingress(),
      input = entrance();
    const micros = captureTrajectoryReceipt(
      receiver,
      "/ugv/gnss",
      payload({ entity_id: "ugv1", longitude: 113, latitude: 23, time_us: "1791840000000001" }),
      input,
      "SIMULATED",
    );
    expect(micros.reportedTime).toMatchObject({
      rawValueJson: '"1791840000000001"',
      unit: "MICROSECONDS_UNSPECIFIED_EPOCH",
      normalizedUtc: null,
      calibration: null,
      quality: "UNKNOWN_TIMEBASE",
      valueProvenance: "DECODED_JSON_VALUE_NOT_ORIGINAL_WIRE_LEXEME",
    });
    const unsafe = captureTrajectoryReceipt(
      receiver,
      "/ugv/gnss",
      Buffer.from('{"entity_id":"ugv1","longitude":113,"latitude":23,"time_us":9007199254740993}'),
      input,
      "SIMULATED",
    );
    expect(unsafe.reportedTime?.quality).toBe("INVALID");
    expect(unsafe.reportedTime?.normalizedUtc).toBeNull();
  });
  it("uses the actual entrance clock and never the payload or Snapshot clock", () => {
    const receiver = ingress(),
      input = entrance();
    const body = payload({
      entity_id: "ugv1",
      latitude: 23,
      longitude: 113,
      providerReceivedAt: "1900-01-01T00:00:00Z",
      header: { stamp: { sec: 1, nanosec: 2 }, seq: 99 },
    });
    const record = captureTrajectoryReceipt(receiver, "/ugv/gnss", body, input, "SIMULATED");
    expect(record.providerReceivedAt.utc).toBe(input.receivedUtc);
    expect(record.providerReceivedAt.owner).toBe("PROVIDER_MQTT_MESSAGE_CALLBACK");
    expect(record.sourceReportedSequence).toBe("99");
    expect(record.reportedTime).toMatchObject({
      originalField: "decoded-message:/header/stamp",
      unit: "ROS_SECONDS_NANOSECONDS",
      timeBase: "UNKNOWN",
      normalizedUtc: null,
      reportedClockOwner: "MESSAGE_PRODUCER_UNVERIFIED",
    });
    expect(record.deviceAcquisitionTime).toBeNull();
    expect(record.reportedMission).toBeNull();
    expect(receiver.ingestSequence()).toBe(0);
  });

  it("records duplicates, late deliveries and separate points in the same millisecond", () => {
    const receiver = ingress(),
      input = entrance();
    const bytes = payload({
      entity_id: "ugv1",
      latitude: 23,
      longitude: 113,
      header: { stamp: { sec: 1000, nanosec: 0 }, seq: 5 },
    });
    receiver.handle("/ugv/gnss", bytes, false, input.receivedUtc);
    const repeated = captureTrajectoryReceipt(
      receiver,
      "/ugv/gnss",
      bytes,
      { ...input, receptionId: randomUUID(), duplicateDeliveryHint: true },
      "SIMULATED",
    );
    const late = captureTrajectoryReceipt(
      receiver,
      "/ugv/gnss",
      payload({
        entity_id: "ugv1",
        latitude: 23.001,
        longitude: 113.001,
        header: { stamp: { sec: 900, nanosec: 0 }, seq: 4 },
      }),
      { ...input, receptionId: randomUUID() },
      "SIMULATED",
    );
    expect(repeated.disposition).toBe("POSITION_OBSERVATION");
    expect(late.disposition).toBe("POSITION_OBSERVATION");
    expect(repeated.receptionId).not.toBe(late.receptionId);
    expect(repeated.providerReceivedAt.utc).toBe(late.providerReceivedAt.utc);
    expect(repeated.diagnostics).toContain(
      "TRANSPORT_DUPLICATE_HINT_NOT_DEVICE_SAMPLE_DEDUPLICATION",
    );
    expect(receiver.ingestSequence()).toBe(1);
  });

  it("does not infer a Mission from an earlier message", () => {
    const receiver = ingress();
    receiver.handle(
      "/ugv/mission_state",
      payload({ entity_id: "ugv1", id: "old-mission", state: 1 }),
      false,
      "2026-10-12T01:00:00.000Z",
    );
    const captured = captureTrajectoryReceipt(
      receiver,
      "/ugv/gnss",
      payload({ entity_id: "ugv1", latitude: 23, longitude: 113 }),
      entrance(),
      "SIMULATED",
    );
    expect(captured.reportedMission).toBeNull();
    expect(captured.reportedTime).toBeNull();
    expect(captured.deviceAcquisitionTime).toBeNull();
  });

  it("keeps a foreign-device frame rejected rather than attributing its position", () => {
    const captured = captureTrajectoryReceipt(
      ingress(),
      "/ugv/gnss",
      payload({ entity_id: "other-device", latitude: 24, longitude: 114 }),
      entrance(),
      "SIMULATED",
    );
    expect(captured.disposition).toBe("REJECTED");
    expect(captured.reasonCode).toBe("UGV_MQTT_ENTITY_MISMATCH");
    expect(captured.position).toBeNull();
    expect(captured.diagnostics).toContain("SOURCE_DEVICE_IDENTITY_REJECTED");
  });

  it("preserves retained delivery and malformed-message evidence without geometry", () => {
    const bad = Buffer.from("invalid JSON");
    const captured = captureTrajectoryReceipt(
      ingress(),
      "/ugv/gnss",
      bad,
      { ...entrance(), retainedDelivery: true },
      "SIMULATED",
    );
    expect(captured.disposition).toBe("REJECTED");
    expect(captured.originalMessageBytes).toBe(bad.length);
    expect(captured.originalMessageSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(captured.position).toBeNull();
    expect(captured.diagnostics).toContain("RETAINED_DELIVERY_NOT_NEW_DEVICE_GENERATION");
  });
});
