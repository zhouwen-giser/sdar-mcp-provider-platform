import { describe, expect, it } from "vitest";
import { resolveReconExecutionCorrelation } from "../../apps/ugv-provider-adapter/src/recon-execution-correlation.js";
import type { ProviderExecution } from "../../packages/provider-adapter-kit/src/index.js";
import {
  VehicleMqttIngress,
  type AppliedMqttObservation,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";

const at = "2026-09-29T10:00:00.000Z";
const nowMs = Date.parse(at);
const run: ProviderExecution = {
  taskId: "recon-task",
  externalExecutionId: "recon-execution",
  operationName: "vehicle_area_recon",
  providerId: "provider-a",
  resourceId: "vehicle:ugv1",
  argumentHash: "a".repeat(64),
  arguments: {},
  executionContext: {
    authorizationContextHash: "b".repeat(64),
    executionMode: "SIMULATION",
    simulationId: "correlation-test",
    correlationId: "correlation-test",
  },
  tracks: [],
  downstreamMissionIds: ["11"],
  taskBusinessContextExpected: true,
  state: "RUNNING",
  revision: 2,
  reasonCode: "UGV_RECON_RUNNING",
  createdAt: new Date(nowMs - 1000).toISOString(),
  updatedAt: at,
  evidence: [],
};

function packet(topic = "status", identity: Record<string, unknown> = {}, observedAt = at) {
  const ingress = new VehicleMqttIngress("direct_domain_json", {
    maxPayloadBytes: 65_536,
    maxDepth: 16,
    maxNodes: 4096,
    maxStringBytes: 16384,
  });
  let applied: AppliedMqttObservation | undefined;
  ingress.onSnapshot((_snapshot, _topic, current) => {
    applied = current;
  });
  const payload =
    topic === "status"
      ? { status: 5, lock: { stage: 1, target_id: 0 }, ...identity }
      : topic === "targets"
        ? {
            targets: [{ target_id: 7, capture_time_us: Date.parse(observedAt) * 1000 }],
            ...identity,
          }
        : { run_id: 1, covered_count: 1, total_count: 10, ...identity };
  ingress.handle(
    `/ugv/area_recon/${topic}`,
    Buffer.from(JSON.stringify(payload)),
    false,
    observedAt,
  );
  if (!applied) throw new Error("FIXTURE_OBSERVATION_NOT_APPLIED");
  return applied;
}

function resolve(
  applied: AppliedMqttObservation | undefined,
  active = [run],
  maximumFutureSkewMs = 0,
) {
  return resolveReconExecutionCorrelation({
    active,
    applied,
    nowMs,
    maxAgeMs: 3000,
    maximumFutureSkewMs,
    providerId: "provider-a",
    resourceId: "vehicle:ugv1",
  });
}

describe("Recon exact-packet correlation, supplement R1–R3", () => {
  it("applies the same future tolerance to individual physical observation fields", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65536,
      maxDepth: 16,
      maxNodes: 4096,
      maxStringBytes: 16384,
    });
    ingress.handle("/ugv/speed", Buffer.from('{"speed_kmh":0}'), false, at);
    expect(ingress.fieldFreshnessState("chassis.speed", 3000, nowMs - 1700)).toBe("stale");
    for (const offset of [1700, 3000])
      expect(ingress.fieldFreshnessState("chassis.speed", 3000, nowMs - offset, 3000)).toBe(
        "fresh",
      );
    for (const offset of [-3001, 3001])
      expect(ingress.fieldFreshnessState("chassis.speed", 3000, nowMs + offset, 3000)).toBe(
        "stale",
      );
  });
  it.each(["status", "targets", "coverage"])(
    "uses the configured future clock tolerance for %s without extending expiry",
    (topic) => {
      const active = [{ ...run, createdAt: new Date(nowMs - 10000).toISOString() }];
      for (const offset of [1700, 3000]) {
        const source = packet(topic, {}, new Date(nowMs + offset).toISOString());
        expect(resolve(source, active, 3000).kind).toBe("INFERRED_CURRENT_EXECUTION");
        expect(resolve(source, active, 1000).kind).toBe("UNRESOLVED");
      }
      for (const offset of [3001, -3001])
        expect(
          resolve(packet(topic, {}, new Date(nowMs + offset).toISOString()), active, 3000).kind,
        ).toBe("UNRESOLVED");
    },
  );
  it.each(["status", "targets", "coverage"])(
    "infers fresh anonymous %s from a unique active execution",
    (topic) => {
      expect(resolve(packet(topic))).toMatchObject({
        kind: "INFERRED_CURRENT_EXECUTION",
        missionId: "11",
        execution: run,
      });
    },
  );

  it.each(["mission_id", "missionId", "session_id", "sessionId", "id"])(
    "strictly matches explicit %s",
    (key) => {
      expect(resolve(packet("status", { [key]: "11" }))).toMatchObject({
        kind: "STRICT_CORRELATED",
      });
      expect(resolve(packet("status", { [key]: "12" }))).toEqual({ kind: "UNRESOLVED" });
    },
  );

  it("rejects conflicting status aliases and does not read target ids as mission ids", () => {
    expect(resolve(packet("status", { mission_id: 11, id: 12 }))).toEqual({ kind: "UNRESOLVED" });
    expect(resolve(packet("targets", { id: 7 }))).toMatchObject({
      kind: "INFERRED_CURRENT_EXECUTION",
    });
  });

  it.each([null, "", " 11", "11 ", {}, 1.5])(
    "does not treat malformed explicit identity %j as anonymous",
    (mission_id) => {
      expect(resolve(packet("status", { mission_id }))).toEqual({ kind: "UNRESOLVED" });
    },
  );

  it("checks nested lock identity and rejects conflicts with the packet identity", () => {
    expect(
      resolve(packet("status", { lock: { stage: 3, target_id: 7, mission_id: 11 } })),
    ).toMatchObject({ kind: "STRICT_CORRELATED" });
    expect(
      resolve(
        packet("status", { mission_id: 11, lock: { stage: 3, target_id: 7, mission_id: 12 } }),
      ),
    ).toEqual({ kind: "UNRESOLVED" });
  });

  it("rejects no active execution, wrong resource, terminal and ambiguous executions", () => {
    const source = packet();
    for (const active of [
      [],
      [{ ...run, resourceId: "vehicle:other" }],
      [run, { ...run, taskId: "another", externalExecutionId: "another" }],
      ...(
        ["SUCCEEDED", "CANCELLED", "BUSINESS_FAILED", "TECHNICAL_FAILED", "ACCEPTED"] as const
      ).map((state) => [{ ...run, state }]),
    ])
      expect(resolve(source, active)).toEqual({ kind: "UNRESOLVED" });
  });

  it("does not make an unrelated resource ambiguous", () => {
    expect(resolve(packet(), [run, { ...run, resourceId: "vehicle:other" }])).toMatchObject({
      kind: "INFERRED_CURRENT_EXECUTION",
    });
  });

  it("rejects retained, expired, future, pre-creation and pre-dispatch observations", () => {
    const source = packet();
    expect(resolve({ ...source, retained: true })).toEqual({ kind: "UNRESOLVED" });
    for (const offset of [-3001, 1, -1001])
      expect(resolve(packet("status", {}, new Date(nowMs + offset).toISOString()))).toEqual({
        kind: "UNRESOLVED",
      });
    expect(
      resolve(source, [{ ...run, observationCursors: { reconnaissance: source.cursor } }]),
    ).toEqual({ kind: "UNRESOLVED" });
    expect(
      resolve(source, [
        { ...run, dispatchBaseline: { capturedAt: new Date(nowMs + 1).toISOString() } },
      ]),
    ).toEqual({ kind: "UNRESOLVED" });
    expect(
      resolve(source, [
        {
          ...run,
          dispatchBaseline: {
            capturedAt: run.createdAt,
            observationAuthorities: [{ cursor: source.cursor }],
          },
        },
      ]),
    ).toEqual({ kind: "UNRESOLVED" });
  });

  it("accepts a new packet after restart without creating a session model", () => {
    const old = packet("status", {}, run.createdAt);
    expect(
      resolve(packet(), [
        {
          ...run,
          observationCursors: { reconnaissance: old.cursor },
          dispatchBaseline: {
            capturedAt: run.createdAt,
            observationAuthorities: [{ cursor: old.cursor }],
          },
        },
      ]),
    ).toMatchObject({ kind: "INFERRED_CURRENT_EXECUTION" });
  });
});
