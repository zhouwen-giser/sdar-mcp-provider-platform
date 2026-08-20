import { describe, expect, it } from "vitest";
import {
  decodeObservationCursorV1,
  encodeObservationCursorV1,
  type FieldObservationCursorV1,
  type TopicObservationCursorV1,
} from "../../packages/vehicle-provider-core/src/index.js";
import {
  npcTankMqttProfile,
  VehicleMqttIngress,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";

const hash = "a".repeat(64);
const topicPayload: TopicObservationCursorV1 = {
  version: 1,
  kind: "topic",
  topic: "/ugv/mission_state",
  observedAt: "2026-08-20T00:00:00.000Z",
  timeAuthority: "source",
  sourceSequence: "41",
  ingestSequence: 7,
  payloadHash: hash,
};
const fieldPayload: FieldObservationCursorV1 = {
  version: 1,
  kind: "field",
  field: "chassis.mission",
  topic: "/ugv/mission_state",
  observedAt: "2026-08-20T00:00:00.000Z",
  timeAuthority: "source",
  sourceSequence: "41",
  ingestSequence: 7,
  payloadHash: hash,
};

describe("ObservationCursorCodecV1", () => {
  it("round-trips deterministic topic and field cursors without JSONB-unsafe bytes", () => {
    for (const payload of [topicPayload, fieldPayload]) {
      const first = encodeObservationCursorV1(payload);
      const second = encodeObservationCursorV1(structuredClone(payload));
      expect(first).toBe(second);
      expect(first).toMatch(/^oc1\.[A-Za-z0-9_-]+$/);
      expect(hasControlCharacter(first)).toBe(false);
      expect(decodeObservationCursorV1(first)).toEqual(payload);
    }
  });

  it("changes the cursor whenever an identity field changes", () => {
    const baseline = encodeObservationCursorV1(topicPayload);
    for (const changed of [
      { ...topicPayload, topic: "/ugv/status" },
      { ...topicPayload, observedAt: "2026-08-20T00:00:01.000Z" },
      { ...topicPayload, sourceSequence: "42" },
      { ...topicPayload, ingestSequence: 8 },
      { ...topicPayload, payloadHash: "b".repeat(64) },
    ])
      expect(encodeObservationCursorV1(changed)).not.toBe(baseline);
  });

  it.each([
    ["invalid prefix", "oc2.abc"],
    ["invalid base64url", "oc1.a+bc"],
    ["invalid JSON", raw("not-json")],
    ["unknown version", raw({ ...topicPayload, version: 2 })],
    ["unknown kind", raw({ ...topicPayload, kind: "other" })],
    ["unknown field", raw({ ...fieldPayload, field: "chassis.unknown" })],
    ["extra field", raw({ ...topicPayload, extra: true })],
    ["invalid observedAt", raw({ ...topicPayload, observedAt: "not-a-time" })],
    ["invalid ingestSequence", raw({ ...topicPayload, ingestSequence: -1 })],
    ["invalid payloadHash", raw({ ...topicPayload, payloadHash: "A".repeat(64) })],
    ["noncanonical base64url", "oc1.Zg"],
    ["overlong token", `oc1.${"a".repeat(4096)}`],
  ])("rejects %s", (_label, token) => {
    expect(decodeObservationCursorV1(token)).toBeUndefined();
  });
});

describe("VehicleMqttIngress observation cursors", () => {
  it("uses one oc1 codec for UGV topic and field authorities", () => {
    const ingress = ugvIngress();
    const receivedAt = "2026-08-20T00:00:00.000Z";
    const message = {
      header: { stamp: { sec: 1_700_000_000, nanosec: 0 }, seq: 41 },
      entity_id: "ugv1",
      id: 7,
      type: 1,
      state: 1,
      progress: 20,
    };
    ingress.handle("/ugv/mission_state", json(message), false, receivedAt);
    const topicCursor = required(ingress.observationCursor("/ugv/mission_state"));
    const topicAuthority = required(ingress.observationAuthority("/ugv/mission_state"));
    const fieldAuthority = required(ingress.fieldObservationAuthority("chassis.mission"));

    expect(topicAuthority.cursor).toBe(topicCursor);
    expect(decodeObservationCursorV1(topicCursor)).toMatchObject({
      kind: "topic",
      topic: "/ugv/mission_state",
      observedAt: topicAuthority.observedAt,
      sourceSequence: "41",
      ingestSequence: 1,
    });
    expect(decodeObservationCursorV1(fieldAuthority.cursor)).toMatchObject({
      kind: "field",
      field: "chassis.mission",
      topic: "/ugv/mission_state",
      observedAt: fieldAuthority.observedAt,
      sourceSequence: "41",
      ingestSequence: 1,
    });
    expect(JSON.stringify({ topicCursor, topicAuthority, fieldAuthority })).not.toContain(
      "\\u0000",
    );

    const duplicate = ingress.handle("/ugv/mission_state", json(message), false, receivedAt);
    expect(duplicate.duplicate).toBe(true);
    expect(ingress.observationCursor("/ugv/mission_state")).toBe(topicCursor);

    ingress.handle(
      "/ugv/mission_state",
      json({ ...message, header: { ...message.header, seq: 42 }, progress: 21 }),
      false,
      receivedAt,
    );
    expect(ingress.observationCursor("/ugv/mission_state")).not.toBe(topicCursor);
  });

  it("emits JSONB-safe oc1 cursors for all UGV physical fields", () => {
    const ingress = ugvIngress();
    ingress.handle(
      "/ugv/gnss",
      json({ latitude: 30.1, longitude: 114.1, altitude: 10 }),
      false,
      "2026-08-20T00:00:00.000Z",
    );
    ingress.handle("/ugv/speed", json({ speed_kmh: 0 }), false, "2026-08-20T00:00:01.000Z");
    ingress.handle(
      "/ugv/mission_state",
      json({ entity_id: "ugv1", id: 7, type: 1, state: 1, progress: 20 }),
      false,
      "2026-08-20T00:00:02.000Z",
    );
    ingress.handle(
      "/ugv/area_recon/status",
      json({ status: 5, progress: 40, camera_fault: false }),
      false,
      "2026-08-20T00:00:03.000Z",
    );
    for (const authority of ingress.fieldObservationAuthorities()) {
      expect(authority.cursor).toMatch(/^oc1\.[A-Za-z0-9_-]+$/);
      expect(hasControlCharacter(authority.cursor)).toBe(false);
      expect(decodeObservationCursorV1(authority.cursor)).toMatchObject({
        kind: "field",
        field: authority.field,
        topic: authority.topic,
        observedAt: authority.observedAt,
      });
    }
  });

  it("preserves the shared NPC ingress behavior with oc1 cursors", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", limits, npcTankMqttProfile());
    ingress.handle(
      "/npc_tank1/gnss",
      json({ latitude: 30.1, longitude: 114.1 }),
      false,
      "2026-08-20T00:00:00.000Z",
    );
    const topic = required(ingress.observationCursor("/npc_tank1/gnss"));
    const field = required(ingress.fieldObservationAuthority("chassis.position.geodetic"));
    expect(decodeObservationCursorV1(topic)).toMatchObject({
      kind: "topic",
      topic: "/npc_tank1/gnss",
    });
    expect(decodeObservationCursorV1(field.cursor)).toMatchObject({
      kind: "field",
      field: "chassis.position.geodetic",
      topic: "/npc_tank1/gnss",
    });
  });
});

const limits = {
  maxPayloadBytes: 65_536,
  maxDepth: 16,
  maxNodes: 4096,
  maxStringBytes: 16_384,
};

function ugvIngress(): VehicleMqttIngress {
  return new VehicleMqttIngress("direct_domain_json", limits);
}

function raw(value: unknown): string {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  return `oc1.${Buffer.from(content, "utf8").toString("base64url")}`;
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("OBSERVATION_CURSOR_TEST_VALUE_REQUIRED");
  return value;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) if (value.charCodeAt(index) < 32) return true;
  return false;
}
