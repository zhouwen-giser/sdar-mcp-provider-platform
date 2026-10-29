import { describe, it, expect } from "vitest";
import {
  siteControlV13Operation,
  resolveRegionArguments,
  siteControlV13Tool,
  SITE_CONTROL_V13_PROFILE,
} from "../../packages/vehicle-zmq-control/src/site-control-v13.js";
import {
  siteControlOperation,
  siteControlTool,
  SITE_TOOLS,
} from "../../packages/vehicle-zmq-control/src/site-control-catalog.js";
const vertices = [
  { longitude: 106, latitude: 29 },
  { longitude: 106.001, latitude: 29 },
  { longitude: 106.001, latitude: 29.001 },
  { longitude: 106, latitude: 29.001 },
];
const args = () => ({
  resourceId: "vehicle:ugv",
  area: { crs: "OGC:CRS84", searchStrategy: "recognize", vertices: structuredClone(vertices) },
});
describe("exact 1.3.0 operator height default", () => {
  it.each(["vehicle_zmq_area_recon", "vehicle_zmq_inspect_area"])(
    "resolves omission before native %s and retains provenance",
    (name) => {
      const original = args(),
        before = JSON.stringify(original);
      const resolved = resolveRegionArguments(name, original);
      expect(
        resolved.parameterResolution?.vertices.every(
          (p) => p.source === "default_zero" && p.ellipsoidHeightM === 0,
        ),
      ).toBe(true);
      expect(JSON.stringify(original)).toBe(before);
      const op = siteControlV13Operation(name, original).operation;
      expect(op.params).toMatchObject({
        region_wgs84: vertices.map((p) => ({
          longitude_deg: p.longitude,
          latitude_deg: p.latitude,
          ellipsoid_height_m: 0,
        })),
      });
      expect(() => siteControlOperation(name, original)).toThrow();
    },
  );
  it.each([0, 250.25])("preserves an explicit height %s", (height) => {
    const value = args();
    Object.assign(value.area.vertices[0] ?? {}, { ellipsoidHeightM: height });
    expect(
      resolveRegionArguments("vehicle_zmq_inspect_area", value).parameterResolution?.vertices[0],
    ).toEqual({ index: 0, source: "provided", ellipsoidHeightM: height });
  });
  it.each([null, NaN, Infinity, "0"])("rejects invalid height %s", (height) => {
    const value = args();
    Object.assign(value.area.vertices[0] ?? {}, { ellipsoidHeightM: height });
    expect(() => siteControlV13Operation("vehicle_zmq_inspect_area", value)).toThrow();
  });
  it("preserves a frozen upstream default marker and rejects conflicting provenance", () => {
    const value = args();
    Object.assign(value.area.vertices[0] ?? {}, {
      ellipsoidHeightM: 0,
      ellipsoidHeightSource: "default_zero",
    });
    expect(
      resolveRegionArguments("vehicle_zmq_inspect_area", value).parameterResolution?.vertices[0]
        ?.source,
    ).toBe("default_zero");
    Object.assign(value.area.vertices[0] ?? {}, { ellipsoidHeightM: 5 });
    expect(() => siteControlV13Operation("vehicle_zmq_inspect_area", value)).toThrow(
      "ZMQ_HEIGHT_PROVENANCE_MISMATCH",
    );
  });
  it("publishes thirteen exact tools and preserves the legacy schemas", () => {
    const old = SITE_TOOLS.map((n) => siteControlTool(n, "vehicle:ugv"));
    const tools = SITE_TOOLS.map((n) => siteControlV13Tool(n, "vehicle:ugv"));
    expect(tools).toHaveLength(13);
    expect(
      tools.every((t) => t._meta["io.sdar/ugvZmq"].catalogProfile === SITE_CONTROL_V13_PROFILE),
    ).toBe(true);
    expect(SITE_TOOLS.map((n) => siteControlTool(n, "vehicle:ugv"))).toEqual(old);
    expect(
      siteControlV13Operation("simulation_apply_effect", {
        resourceId: "vehicle:ugv",
        targetId: "manual-1",
        targetSource: "manual",
        sourceNote: "operator target",
        position: { longitude_deg: 106, latitude_deg: 29, ellipsoid_height_m: null },
      }).operation.params,
    ).toMatchObject({ position: { ellipsoid_height_m: null } });
  });
});
