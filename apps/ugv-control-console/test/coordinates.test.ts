import { describe, it, expect } from "vitest";
import { parseCoordinates, regionArguments, validatePolygon } from "../shared/coordinates.js";
import { classifyTask } from "../shared/model.js";
const input =
  "lon: 106.81283082, lat: 29.72057535\nlon: 106.81302505, lat: 29.72031863\nlon: 106.81328403, lat: 29.72044495\nlon: 106.81311812, lat: 29.72077910";
describe("operator coordinates and honest results", () => {
  it("keeps longitude/latitude and adapts the exact requested polygon", () => {
    const points = parseCoordinates(input);
    expect(points[0]).toEqual({ longitude: 106.81283082, latitude: 29.72057535 });
    expect(regionArguments("vehicle:ugv", input, true)).toMatchObject({
      area: {
        boundary: [
          { x: 106.81283082, y: 29.72057535 },
          { x: 106.81302505, y: 29.72031863 },
          { x: 106.81328403, y: 29.72044495 },
          { x: 106.81311812, y: 29.7207791 },
        ],
      },
    });
    expect(regionArguments("v", input, false)).toMatchObject({
      area: { polygon: points },
      scanCount: 1,
    });
  });
  it("honors explicit axis labels even when their order differs", () => {
    expect(parseCoordinates("lat: 29, lon: 50")).toEqual([{ longitude: 50, latitude: 29 }]);
    expect(() => parseCoordinates("lon: 50, lon: 29")).toThrow();
  });
  it.each(["181, 29", "106,91", "x106, 29", "106,29,3", "NaN,29", "Infinity,29", ""])(
    "rejects malformed coordinate %s",
    (value) => expect(() => parseCoordinates(value)).toThrow(),
  );
  it.each(["0,0\n1,1\n0,1\n1,0", "0,0\n1,1\n2,2", "0,0\n1,0\n1,1\n1,0", "179,0\n-179,0\n179,1"])(
    "rejects invalid polygon %s",
    (value) => expect(() => validatePolygon(parseCoordinates(value))).toThrow(),
  );
  it("accepts an explicit closing vertex without duplicate dispatch points", () =>
    expect(validatePolygon(parseCoordinates("0,0\n1,0\n1,1\n0,0"))).toHaveLength(3));
  it("distinguishes ack, stopping, business failure, evidence missing and success", () => {
    expect(classifyTask({ resultType: "complete" }).label).toBe("状态未确认");
    expect(
      classifyTask({
        status: "working",
        _meta: { "io.sdar/taskExecution": { substate: "stopping" } },
      }).label,
    ).toBe("停止中");
    expect(classifyTask({ status: "completed", result: { isError: true } }).tone).toBe("error");
    expect(
      classifyTask({
        status: "completed",
        result: {
          isError: false,
          structuredContent: {
            anomalies: [],
            inspectionReport: { completion: "unavailable" },
            missingEvidence: ["target_report"],
          },
        },
      }).tone,
    ).toBe("warning");
    expect(
      classifyTask({
        status: "completed",
        result: {
          isError: false,
          structuredContent: {
            anomalies: [],
            inspectionReport: { completion: "complete" },
            missingEvidence: [],
          },
        },
      }).tone,
    ).toBe("success");
  });
});
