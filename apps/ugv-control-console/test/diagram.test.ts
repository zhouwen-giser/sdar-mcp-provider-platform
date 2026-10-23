import { it, expect } from "vitest";
import { geometryLayers, visibleGeometryObjects } from "../web/Diagram.js";
const route = (id: string, revision: number, kind = "geojson") => ({
  kind: "artifact",
  value: {
    artifactId: id,
    artifactType: "navigation.route",
    revision,
    content: {
      kind,
      crs: "OGC:CRS84",
      geometry: {
        type: "LineString",
        coordinates: [
          [106, 29],
          [106.1, 29.1],
        ],
      },
    },
  },
});
it("renders the adopted exact route and never turns local geometry into GNSS", () => {
  const selected = visibleGeometryObjects([route("a", 1), route("a", 2), route("candidate", 1)], {
    activeRefs: { route: { kind: "artifact", id: "a", revision: 2 } },
  });
  expect(selected).toEqual([route("a", 2)]);
  expect(geometryLayers(selected)[0].name).toBe("已采用路线");
  expect(geometryLayers([route("local", 1, "local_geometry")])).toEqual([]);
});
