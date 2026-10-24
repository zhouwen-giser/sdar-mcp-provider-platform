import { describe, expect, it } from "vitest";
import {
  ObservationNormalizer,
  multipartHash,
  reconstructFrames,
  observerIdentity,
} from "../../packages/vehicle-zmq-observer/src/index.js";
import {
  clock,
  emptyReport,
  eoFrames,
  jsonFrames,
  localization,
  profile,
  scope,
  settings,
  sourceFrames,
} from "./helpers.js";

describe("SIMULATED observation normalization and raw evidence", () => {
  it("retains lossless source time, WGS84 axes and unknown attitude/time/datum semantics", () => {
    const n = new ObservationNormalizer(profile(), settings()),
      r = n.receive("chassis", localization(18446744073709551615n), clock());
    expect(r.valid).toBe(true);
    expect(r.observation).toMatchObject({
      deviceId: "1",
      sourceTime: { unit: "unconfirmed_us", value: "18446744073709551615" },
      runtimeTaskId: null,
      sourceProducerEpoch: null,
      position: {
        altitudeDatum: "unconfirmed",
      },
    });
    expect(r.observation?.position?.longitude).toBeGreaterThan(100);
    expect(r.observation?.position?.latitude).toBeLessThan(40);
    expect(r.observation?.data).toHaveProperty("attitudeRaw");
    expect(r.observation?.data).not.toHaveProperty("headingDegrees");
    expect(reconstructFrames(r)).toEqual(localization(18446744073709551615n));
  });
  it.each(["eo", "simulationEffect"] as const)(
    "validates actual %s publication structure with explicit origin/identity",
    (component) => {
      const n = new ObservationNormalizer(profile(), settings()),
        r = n.receive(component, jsonFrames(component), clock());
      expect(r).toMatchObject({
        valid: true,
        projectable: true,
        observation: { versionEvidence: "in_band", runtimeTaskId: null, sourceProducerEpoch: null },
      });
      expect(reconstructFrames(r)).toEqual(jsonFrames(component));
    },
  );
  it("records malformed multipart and CRC bytes without promoting state", () => {
    const n = new ObservationNormalizer(profile(), settings()),
      bad = localization();
    bad[0]?.writeUInt8(200, (bad[0]?.length ?? 1) - 1);
    const crc = n.receive("chassis", bad, clock());
    expect(crc.valid).toBe(false);
    expect(crc.validationCode).toContain("CRC");
    expect(reconstructFrames(crc)).toEqual(bad);
    const parts = [...jsonFrames("eo"), Buffer.from("extra")],
      r = n.receive("eo", parts, clock(2));
    expect(r).toMatchObject({
      valid: false,
      projectable: false,
      observation: null,
      rawComplete: true,
    });
    expect(reconstructFrames(r)).toEqual(parts);
  });
  it("rejects foreign IDs/targets and versions while preserving the actual wire", () => {
    const p = profile();
    p.components.chassis.systemId = "2";
    expect(
      new ObservationNormalizer(p, settings()).receive("chassis", localization(), clock()),
    ).toMatchObject({ valid: false, observation: null });
    const frames = jsonFrames("eo");
    frames[1] = Buffer.from((frames[1]?.toString() ?? "").replace('"2.2"', '"2.3"'));
    expect(
      new ObservationNormalizer(profile(), settings()).receive("eo", frames, clock())
        .validationCode,
    ).toBe("ZMQ_JSON_SCHEMA_MISMATCH");
    const targeted = localization();
    targeted[0]?.writeBigUInt64LE(99n, (targeted[0]?.indexOf(0x3a) ?? 0) + 13);
    expect(
      new ObservationNormalizer(profile(), settings()).receive("chassis", targeted, clock())
        .validationCode,
    ).toBe("ZMQ_PUBLICATION_TARGET_UNMATCHED");
  });
  it("makes oversize raw capture explicitly incomplete and rejects hash tampering", () => {
    const n = new ObservationNormalizer(profile(), settings());
    const r = n.receive("eo", [Buffer.alloc(140001)], clock());
    expect(r).toMatchObject({
      rawComplete: false,
      multipartSha256: null,
      valid: false,
      frames: [],
    });
    expect(() => reconstructFrames(r)).toThrow("INCOMPLETE");
    const good = n.receive("eo", jsonFrames("eo"), clock(2));
    if (good.frames[0]) good.frames[0].sha256 = "0".repeat(64);
    expect(() => reconstructFrames(good)).toThrow("INTEGRITY");
    expect(multipartHash([Buffer.from("a"), Buffer.from("b")])).not.toBe(
      multipartHash([Buffer.from("ab")]),
    );
  });
  it("keeps repeated/regressed source time from refreshing state, and a skewed future timestamp cannot poison the watermark", () => {
    const n = new ObservationNormalizer(profile(), settings());
    expect(n.receive("eo", jsonFrames("eo"), clock()).projectable).toBe(true);
    expect(n.receive("eo", jsonFrames("eo"), clock(2)).diagnostics).toContain(
      "SOURCE_TIME_REPEATED",
    );
    expect(
      n.receive("eo", jsonFrames("eo", "device_status", 1792799999999), clock(3)).diagnostics,
    ).toContain("SOURCE_TIME_REGRESSED_OR_REPLAYED");
    expect(
      n.receive("eo", jsonFrames("eo", "device_status", 1792800060000), clock(4)).diagnostics,
    ).toContain("SOURCE_PUBLICATION_CLOCK_SKEW");
    expect(
      n.receive("eo", jsonFrames("eo", "device_status", 1792800000001), clock(5)).projectable,
    ).toBe(true);
    const chassis = new ObservationNormalizer(profile(), settings());
    chassis.receive("chassis", localization(10n), clock());
    expect(chassis.receive("chassis", localization(9n), clock(2))).toMatchObject({
      valid: true,
      projectable: false,
    });
  });
  it("preserves explicit empty/unknown-time/truncated reports and detects immutable image conflicts", () => {
    const n = new ObservationNormalizer(profile(), settings());
    const first = n.receive("eo", eoFrames("targetlist", emptyReport()), clock());
    expect(first.observation).toMatchObject({
      nativeTaskId: "native-task",
      runtimeTaskId: null,
      position: null,
      acquisitionUtcMs: null,
      data: { targets: [], truncated: false },
    });
    expect(first.diagnostics).toContain("ACQUISITION_TIME_UNKNOWN");
    const repeated = n.receive(
      "eo",
      eoFrames("targetlist", emptyReport(), 1792800000001),
      clock(2),
    );
    expect(repeated.projectable).toBe(false);
    expect(repeated.diagnostics).toContain("IMAGE_REPORT_REPEATED");
    const conflict = n.receive(
      "eo",
      eoFrames("targetlist", emptyReport({ truncated: true }), 1792800000002),
      clock(3),
    );
    expect(conflict.projectable).toBe(false);
    expect(conflict.diagnostics).toContain("IMAGE_REPORT_CONTENT_CONFLICT");
  });
  it.each([false, null])(
    "preserves coverage_complete=%s at ratio 1 and native task isolation",
    (complete) => {
      const task = {
        task_id: "native-a",
        task_type: "AreaSearch",
        state: "completed",
        remaining_ms: 0,
        progress_ratio: 1,
        coverage_ratio: 1,
        coverage_complete: complete,
        completed_cycles: null,
        total_cycles: null,
        reason: null,
      };
      const r = new ObservationNormalizer(profile(), settings()).receive(
        "eo",
        eoFrames("task_status", { task, command: null }),
        clock(),
      );
      expect(r.valid).toBe(true);
      expect(r.observation).toMatchObject({
        nativeTaskId: "native-a",
        runtimeTaskId: null,
        data: { task: { coverage_ratio: 1, coverage_complete: complete } },
      });
    },
  );
  it("retains every repeated timestamp-free state receipt and diagnoses UTC regression independently", () => {
    const n = new ObservationNormalizer(profile(), settings());
    n.receive("chassis", sourceFrames("chassis", "systemState"), clock(1));
    const r = n.receive("chassis", sourceFrames("chassis", "systemState"), clock(2, 1792799999000));
    expect(r.valid).toBe(true);
    expect(r.projectable).toBe(true);
    expect(r.diagnostics).toEqual(
      expect.arrayContaining([
        "RECEPTION_UTC_CLOCK_REGRESSED",
        "REPEATED_WIRE_BYTES",
        "SOURCE_TIME_NOT_SUPPLIED",
      ]),
    );
  });
  it("separates unknown deployment partitions, profile versions and explicit simulation reset bindings", () => {
    expect(scope().identity).toMatchObject({
      deploymentBinding: "unqualified_diagnostic",
      sourceProducerEpoch: null,
      executionDomain: { simulationId: null },
    });
    expect(scope().partitionHash).not.toBe(scope(profile(), "other-receiver").partitionHash);
    const p = profile();
    p.executionDomain.simulationId = "scene-new";
    expect(scope(p).partitionHash).not.toBe(scope().partitionHash);
    expect(
      observerIdentity(profile(), "SIMULATED-test", "c".repeat(64), "b".repeat(64)).partitionHash,
    ).not.toBe(scope().partitionHash);
  });
});
