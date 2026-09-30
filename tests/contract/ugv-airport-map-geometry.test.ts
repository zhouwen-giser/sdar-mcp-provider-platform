import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  airportRangeSector,
  airportCoveredCells,
  airportFootprintFact,
  AIRPORT_SECTOR_MODEL,
} from "../../apps/ugv-provider-adapter/src/airport-map-geometry.js";
import { assertUgvTaskBusinessSettingsSupported } from "../../apps/ugv-provider-adapter/src/task-business-bootstrap.js";
import { UgvTaskBusinessSettingsSchema } from "../../packages/runtime-configuration-contract/src/providers/ugv-business.js";
import { providerReconBusinessProfile } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { ArtifactContentSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import type { AppliedMqttObservation } from "../../packages/vehicle-mqtt-ingress/src/index.js";
const now = Date.parse("2026-09-30T03:00:01.000Z");
const packet = (patch: AppliedMqttObservation["observation"]["patch"]): AppliedMqttObservation => ({
  cursor: JSON.stringify(patch),
  observedAt: new Date(now).toISOString(),
  retained: false,
  observation: { patch, canonicalPayload: patch, domains: ["payload"], timeAuthority: "ingest" },
});
const input = () => ({
  missionId: "1",
  createdAt: new Date(now - 1000).toISOString(),
  nowMs: now,
  maxAgeMs: 3000,
  rangeM: 140,
  status: packet({
    payload: { reconnaissance: { motionStatus: 5, eoFovDeg: 120, loadStatus: 3 } },
  }),
  position: packet({ chassis: { position: { longitude: 106.81485, latitude: 29.7195 } } }),
  heading: packet({ chassis: { compassHeadingDeg: 180 } }),
  gimbal: packet({ payload: { gimbal: { yaw: 0 } } }),
});
describe("airport estimated Map-full source", () => {
  it("produces the declared east-facing sector and validates closed GeoJSON", () => {
    const value = airportRangeSector({
      longitude: 106.81485,
      latitude: 29.7195,
      compassHeadingDeg: 180,
      relativeGimbalYawDeg: 0,
      rangeM: 140,
      fovDeg: 120,
    });
    expect(ArtifactContentSchema.safeParse(value).success).toBe(true);
    const ring = value.geometry.coordinates[0];
    if (!ring) throw new Error("MISSING_RING");
    expect(ring.at(-1)).toEqual(ring[0]);
    const middle = ring[13];
    if (middle?.[0] === undefined) throw new Error("MISSING_MIDDLE_POINT");
    expect((middle[0] - 106.81485) * 111320).toBeCloseTo(140, 6);
    expect(middle[1]).toBeCloseTo(29.7195, 8);
    expect(() =>
      airportRangeSector({
        longitude: 0,
        latitude: 0,
        compassHeadingDeg: 0,
        relativeGimbalYawDeg: 0,
        rangeM: 0,
        fovDeg: 120,
      }),
    ).toThrow();
  });
  it("binds fresh inputs and marks geometry estimated with expiry", () => {
    expect(airportFootprintFact(input())).toMatchObject({
      state: "active",
      quality: "estimated",
      sourceKind: "configured_model",
      modelRef: AIRPORT_SECTOR_MODEL,
      validUntil: new Date(now + 3000).toISOString(),
    });
  });
  it("allows only the configured future skew and keeps the source expiry unchanged", () => {
    const p = input();
    const shifted = {
      ...p,
      maximumFutureSkewMs: 3000,
      gimbal: { ...p.gimbal, observedAt: new Date(now + 1700).toISOString() },
    };
    expect(airportFootprintFact(shifted)).toMatchObject({
      state: "active",
      observedAt: new Date(now + 1700).toISOString(),
      validUntil: new Date(now + 3000).toISOString(),
    });
    expect(airportFootprintFact({ ...shifted, maximumFutureSkewMs: 1000 }).state).toBe("paused");
    expect(
      airportFootprintFact({
        ...shifted,
        gimbal: { ...p.gimbal, observedAt: new Date(now + 3001).toISOString() },
      }).state,
    ).toBe("paused");
    expect(airportFootprintFact({ ...shifted, nowMs: now + 3001 }).state).toBe("paused");
  });
  it("invalidates stale, retained, pre-execution, missing, paused and faulty observations", () => {
    const p = input();
    for (const changed of [
      { ...p, nowMs: now + 3001 },
      { ...p, gimbal: { ...p.gimbal, retained: true } },
      { ...p, createdAt: new Date(now + 1).toISOString() },
      { ...p, rangeM: 0 },
      {
        ...p,
        status: packet({
          payload: { reconnaissance: { motionStatus: 8, lock: { stage: 1 }, eoFovDeg: 120 } },
        }),
      },
      {
        ...p,
        status: packet({
          payload: { reconnaissance: { motionStatus: 5, cameraFault: true, eoFovDeg: 120 } },
        }),
      },
    ])
      expect(airportFootprintFact(changed).state).not.toBe("active");
    expect(
      airportFootprintFact({
        ...p,
        status: packet({
          payload: { reconnaissance: { motionStatus: 8, lock: { stage: 3 }, eoFovDeg: 120 } },
        }),
      }).state,
    ).toBe("active");
  });
  it("maps signed world centres and merges adjacent display cells without filling holes", () => {
    const content = airportCoveredCells(
      [
        { x: -6, y: -3 },
        { x: -3, y: -3 },
        { x: 6, y: -3 },
      ],
      3,
    );
    if (!content) throw new Error("MISSING_COVERAGE_GEOMETRY");
    expect(ArtifactContentSchema.safeParse(content).success).toBe(true);
    expect(content.geometry.coordinates).toHaveLength(2);
    const longitude = content.geometry.coordinates[0]?.[0]?.[0]?.[0];
    if (longitude === undefined) throw new Error("MISSING_LONGITUDE");
    expect((longitude - 106.81485) * 111320).toBeCloseTo(-7.5, 6);
    expect(airportCoveredCells([], 3)).toBeUndefined();
    expect(
      airportCoveredCells(
        Array.from({ length: 101 }, (_, i) => ({ x: i * 10, y: i * 10 })),
        3,
      ),
    ).toBeUndefined();
  });
  it("accepts only the reviewed simulator model and advertises the estimate", () => {
    const settings = UgvTaskBusinessSettingsSchema.parse(
      JSON.parse(readFileSync("deploy/development/server/profiles/ugv-business.json", "utf8")),
    );
    expect(() => assertUgvTaskBusinessSettingsSupported(settings, true)).not.toThrow();
    expect(() => assertUgvTaskBusinessSettingsSupported(settings, false)).toThrow();
    expect(() =>
      assertUgvTaskBusinessSettingsSupported(
        { ...settings, footprint: { mode: "estimated", model: "unknown" } },
        true,
      ),
    ).toThrow();
    const profile = providerReconBusinessProfile(
      {
        maxWaitMs: 300000,
        onExpire: "release_and_resume_scan",
        onDismiss: "release_and_resume_scan",
      },
      true,
    );
    expect(profile.artifactTypes).toContain("recon.current_footprint");
    expect(profile).toMatchObject({
      policy: { footprintMode: "estimated" },
      qualification: { footprint: "qualified" },
    });
  });
});
