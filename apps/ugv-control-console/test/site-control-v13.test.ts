import { describe, it, expect } from "vitest";
import {
  kilometresPerHourToMps,
  inspectionArgumentsV13,
  inspectionArguments,
  validateZmqGeometry,
} from "../shared/zmq.js";
import { nativeCatalogReason, nativeContract } from "../shared/zmq-native.js";
import catalog from "../shared/zmq-site-control-v13-catalog.json" with { type: "json" };
const polygon = "106,29\n106.001,29\n106.001,29.001\n106,29.001";
describe("new console catalog and defaults", () => {
  it("keeps blank input distinct from a provided zero", () => {
    const omitted = inspectionArgumentsV13("vehicle:ugv", polygon, "", "recognize");
    expect(omitted.area.vertices[0]).not.toHaveProperty("ellipsoidHeightM");
    expect(() => validateZmqGeometry(omitted, true)).not.toThrow();
    expect(
      inspectionArgumentsV13("vehicle:ugv", polygon, "0", "recognize").area.vertices[0],
    ).toHaveProperty("ellipsoidHeightM", 0);
    expect(() => inspectionArguments("vehicle:ugv", polygon, "", "recognize")).toThrow();
  });
  it("converts the confirmed 60 km/h and rejects invalid speeds", () => {
    expect(kilometresPerHourToMps(60)).toBe(60 / 3.6);
    for (const value of [60000, 0, -1, NaN, Infinity])
      expect(() => kilometresPerHourToMps(value)).toThrow();
  });
  it("rejects mixed or drifted catalogs", () => {
    const tools = catalog.tools.map((t) => {
      const tool = nativeContract(t.name, "vehicle:ugv", catalog.profile);
      if (!tool) throw Error("REVIEWED_TOOL_REQUIRED");
      return tool;
    });
    expect(nativeCatalogReason(tools, "vehicle:ugv")).toBeNull();
    const first = tools[0];
    if (!first) throw Error("REVIEWED_TOOL_REQUIRED");
    const legacy = nativeContract(first.name, "vehicle:ugv", "zmq_v1_2_0_site_control_13");
    if (!legacy) throw Error("REVIEWED_TOOL_REQUIRED");
    tools[0] = legacy;
    expect(nativeCatalogReason(tools, "vehicle:ugv")).toBe("ZMQ_NATIVE_CONTRACT_MISMATCH");
  });
});
