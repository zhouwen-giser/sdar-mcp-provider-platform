import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  TASK_BUSINESS_ARTIFACT_SCHEMA_VERSION,
  TaskArtifactSchema,
  prepareArtifactContentRead,
  taskBusinessArtifactJsonSchema,
} from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import { TASK_BUSINESS_PROFILE_VERSION } from "../../packages/vehicle-provider-core/src/task-business-contract.js";

const at = "2026-09-23T00:00:00Z";
const identity = {
  taskId: "task-1",
  executionId: "execution-1",
  providerId: "provider-1",
  resourceId: "vehicle:ugv1",
  operationName: "vehicle_area_recon",
};
const base = {
  schemaVersion: TASK_BUSINESS_ARTIFACT_SCHEMA_VERSION,
  artifactId: "route-1",
  artifactType: "navigation.route",
  revision: 3,
  semantics: "planned",
  lifecycle: "active",
  identity,
  source: { producer: "device_planner", sourceRecordRef: "plan-1" },
  createdAt: at,
  updatedAt: at,
  properties: { adoption: "adopted", purpose: "navigation", routeSource: "device_planner" },
};
const route = {
  ...base,
  availability: "available",
  content: {
    kind: "geojson",
    crs: "OGC:CRS84",
    geometry: {
      type: "LineString",
      coordinates: [
        [116, 39],
        [116.001, 39.001],
      ],
    },
  },
};

describe("task business artifact contract", () => {
  it("generates JSON Schema from the canonical runtime schema", () => {
    expect(
      JSON.parse(readFileSync("protocol/task-business/v1/artifact.schema.json", "utf8")),
    ).toEqual({
      profileVersion: TASK_BUSINESS_PROFILE_VERSION,
      schemaVersion: TASK_BUSINESS_ARTIFACT_SCHEMA_VERSION,
      source: "packages/vehicle-provider-core/src/task-business-artifact.ts",
      schema: taskBusinessArtifactJsonSchema(),
    });
  });

  it("requires content for available, and a reason without fake content for unavailable", () => {
    const ajv = new Ajv2020({ strict: true });
    addFormatsImport.default(ajv);
    const validate = ajv.compile(taskBusinessArtifactJsonSchema());
    expect(TaskArtifactSchema.safeParse(route).success).toBe(true);
    expect(validate(route)).toBe(true);
    const noContent = { ...route, content: undefined };
    expect(TaskArtifactSchema.safeParse(noContent).success).toBe(false);
    expect(validate(noContent)).toBe(false);
    const unavailable = { ...base, availability: "unavailable", reasonCode: "PLANNER_NO_ROUTE" };
    expect(TaskArtifactSchema.safeParse(unavailable).success).toBe(true);
    expect(validate(unavailable)).toBe(true);
    expect(TaskArtifactSchema.safeParse({ ...unavailable, reasonCode: undefined }).success).toBe(
      false,
    );
    expect(TaskArtifactSchema.safeParse({ ...unavailable, content: route.content }).success).toBe(
      false,
    );
    const empty = { ...base, availability: "empty", reasonCode: "NO_RESULT", readPerformedAt: at };
    expect(TaskArtifactSchema.safeParse(empty).success).toBe(true);
    expect(TaskArtifactSchema.safeParse({ ...empty, readPerformedAt: undefined }).success).toBe(
      false,
    );
  });

  it("rejects one-point lines, open polygons, out-of-range and nonfinite geographic positions", () => {
    const onePoint = {
      ...route,
      content: { ...route.content, geometry: { type: "LineString", coordinates: [[116, 39]] } },
    };
    expect(TaskArtifactSchema.safeParse(onePoint).success).toBe(false);
    const invalidLongitude = {
      ...route,
      content: {
        ...route.content,
        geometry: {
          type: "LineString",
          coordinates: [
            [181, 39],
            [116, 39],
          ],
        },
      },
    };
    expect(TaskArtifactSchema.safeParse(invalidLongitude).success).toBe(false);
    const infinite = {
      ...route,
      content: {
        ...route.content,
        geometry: {
          type: "LineString",
          coordinates: [
            [Infinity, 39],
            [116, 39],
          ],
        },
      },
    };
    expect(TaskArtifactSchema.safeParse(infinite).success).toBe(false);
    const area = {
      ...base,
      availability: "available",
      artifactType: "recon.area",
      properties: { areaRevision: 1 },
      content: {
        kind: "geojson",
        crs: "OGC:CRS84",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [116, 39],
              [117, 39],
              [117, 40],
              [116, 40],
            ],
          ],
        },
      },
    };
    expect(TaskArtifactSchema.safeParse(area).success).toBe(false);
    expect(
      TaskArtifactSchema.safeParse({
        ...area,
        content: {
          ...area.content,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [116, 39],
                [117, 39],
                [117, 40],
                [116, 39],
              ],
            ],
          },
        },
      }).success,
    ).toBe(true);
  });

  it("keeps local frames and pixel-only targets distinct from geographic coordinates", () => {
    const local = {
      ...route,
      content: {
        kind: "local_geometry",
        frameId: "sim-map-1",
        unit: "m",
        axisConvention: "ENU",
        geometry: {
          type: "LineString",
          coordinates: [
            [300, 400],
            [301, 402],
          ],
        },
      },
    };
    expect(TaskArtifactSchema.safeParse(local).success).toBe(true);
    expect(
      TaskArtifactSchema.safeParse({
        ...route,
        content: { kind: "geojson", crs: "OGC:CRS84", geometry: local.content.geometry },
      }).success,
    ).toBe(false);
    const target = {
      ...base,
      availability: "available",
      artifactId: "target-1",
      artifactType: "target.object",
      semantics: "observed",
      source: { producer: "simulator_sensor" },
      properties: {
        targetId: "target-1",
        visibility: "visible",
        trackingState: "unlocked",
        firstSeen: {
          clockDomain: "simulator_relative",
          elapsedMilliseconds: 1000,
          clockId: "sim-1",
        },
        lastSeen: {
          clockDomain: "simulator_relative",
          elapsedMilliseconds: 1000,
          clockId: "sim-1",
        },
        sensorId: "camera-1",
        observationSessionId: "session-1",
        lastSeenPositionQuality: "unknown",
      },
      content: {
        kind: "image_observation",
        frameId: "frame-1",
        bbox: { coordinateMode: "pixel", x: 20, y: 30, width: 15, height: 10 },
      },
    };
    expect(TaskArtifactSchema.safeParse(target).success).toBe(true);
    const track = {
      ...base,
      artifactId: "target-track-1",
      artifactType: "target.track",
      semantics: "observed",
      source: { producer: "device" },
      availability: "available",
      properties: { targetId: "target-1", sampleCount: 2 },
      content: {
        kind: "geojson",
        crs: "OGC:CRS84",
        geometry: {
          type: "LineString",
          coordinates: [
            [116, 39],
            [116.001, 39],
          ],
        },
      },
    };
    expect(TaskArtifactSchema.safeParse(track).success).toBe(true);
    expect(
      TaskArtifactSchema.safeParse({
        ...track,
        properties: { targetId: "target-1", sampleCount: 1 },
      }).success,
    ).toBe(false);
    expect(
      TaskArtifactSchema.safeParse({
        ...target,
        content: {
          ...target.content,
          bbox: { coordinateMode: "normalized", x: 0.9, y: 0.9, width: 0.2, height: 0.2 },
        },
      }).success,
    ).toBe(false);
  });

  it("binds opaque content references to the exact artifact revision", () => {
    const content = {
      kind: "content_ref",
      artifactId: "route-1",
      revision: 3,
      readMethod: "business_artifact_content",
      handle: "route-1_3",
      mediaType: "application/geo+json",
      sizeBytes: 500,
      sha256: "a".repeat(64),
    };
    expect(TaskArtifactSchema.safeParse({ ...route, content }).success).toBe(true);
    expect(
      TaskArtifactSchema.safeParse({ ...route, content: { ...content, revision: 2 } }).success,
    ).toBe(false);
    expect(
      TaskArtifactSchema.safeParse({
        ...route,
        content: { ...content, handle: "https://example.com/route" },
      }).success,
    ).toBe(false);
  });

  it("represents one trajectory sample as Point, never an invalid one-point line", () => {
    const absent = {
      ...base,
      artifactType: "navigation.trajectory",
      semantics: "observed",
      availability: "not_produced_yet",
      reasonCode: "ONE_SAMPLE_ONLY",
      properties: undefined,
    };
    expect(TaskArtifactSchema.safeParse(absent).success).toBe(true);
    const oneSample = {
      ...absent,
      availability: "available",
      reasonCode: undefined,
      properties: { sampleCount: 1 },
      content: {
        kind: "geojson",
        crs: "OGC:CRS84",
        geometry: { type: "LineString", coordinates: [[116, 39]] },
      },
    };
    expect(TaskArtifactSchema.safeParse(oneSample).success).toBe(false);
    const availablePoint = {
      ...base,
      artifactType: "navigation.trajectory",
      semantics: "observed",
      availability: "available",
      properties: { sampleCount: 1 },
    };
    expect(
      TaskArtifactSchema.safeParse({
        ...availablePoint,
        content: {
          kind: "geojson",
          crs: "OGC:CRS84",
          geometry: { type: "Point", coordinates: [116, 39] },
        },
      }).success,
    ).toBe(true);
    expect(TaskArtifactSchema.safeParse({ ...route, semantics: "observed" }).success).toBe(false);
    expect(
      TaskArtifactSchema.safeParse({
        ...route,
        content: { kind: "structured", value: { fakeRoute: true } },
      }).success,
    ).toBe(false);
  });

  it("labels estimated footprints as derived and requires the estimation model", () => {
    const footprint = {
      ...base,
      artifactId: "footprint-1",
      artifactType: "recon.current_footprint",
      semantics: "derived",
      properties: { areaRevision: 1, quality: "estimated", model: "fov-no-occlusion-v1" },
      availability: "available",
      content: {
        kind: "local_geometry",
        frameId: "sim-map-1",
        unit: "m",
        axisConvention: "ENU",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
    };
    expect(TaskArtifactSchema.safeParse(footprint).success).toBe(true);
    expect(
      TaskArtifactSchema.safeParse({
        ...footprint,
        properties: { areaRevision: 1, quality: "estimated" },
      }).success,
    ).toBe(false);
    expect(TaskArtifactSchema.safeParse({ ...footprint, semantics: "observed" }).success).toBe(
      false,
    );
  });

  it("prepares only the authorized exact version and rejects an expired stored reference", () => {
    const content = {
      kind: "content_ref",
      artifactId: "route-1",
      revision: 3,
      readMethod: "business_artifact_content",
      handle: "route-1_3",
      mediaType: "application/geo+json",
      sizeBytes: 500,
      sha256: "a".repeat(64),
      expiresAt: "2026-09-24T00:00:00Z",
    };
    const stored = TaskArtifactSchema.parse({ ...route, content });
    const request = { identity, artifactId: "route-1", revision: 3 };
    expect(prepareArtifactContentRead(stored, request, new Date(at))).toEqual({
      kind: "stored",
      handle: "route-1_3",
      mediaType: "application/geo+json",
      sizeBytes: 500,
      sha256: "a".repeat(64),
    });
    expect(() =>
      prepareArtifactContentRead(stored, { ...request, revision: 2 }, new Date(at)),
    ).toThrow("ARTIFACT_REVISION_NOT_FOUND");
    expect(() =>
      prepareArtifactContentRead(
        stored,
        { ...request, identity: { ...identity, executionId: "other" } },
        new Date(at),
      ),
    ).toThrow("ARTIFACT_SCOPE_MISMATCH");
    expect(() =>
      prepareArtifactContentRead(stored, request, new Date("2026-09-24T00:00:00Z")),
    ).toThrow("ARTIFACT_CONTENT_EXPIRED");
  });
});
