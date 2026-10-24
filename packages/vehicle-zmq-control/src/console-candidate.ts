import { z } from "zod";
import { Operation, type Operation as OperationType } from "./model.js";
/** Restricted candidate input adapter. It does not publish or alter the frozen northbound catalog. */
export function operationFromConsoleCandidate(
  name: string,
  input: unknown,
): { resourceId: string; operation: OperationType } {
  const resource = z.string().min(1).max(128);
  if (name === "vehicle_zmq_inspect_area") {
    const value = z
      .object({
        resourceId: resource,
        area: z
          .object({
            crs: z.literal("OGC:CRS84"),
            searchStrategy: z.enum(["recognize", "track"]),
            vertices: z
              .array(
                z
                  .object({
                    longitude: z.number().gte(-180).lt(180),
                    latitude: z.number().min(-90).max(90),
                    ellipsoidHeightM: z.number(),
                  })
                  .strict(),
              )
              .length(4),
          })
          .strict(),
      })
      .strict()
      .parse(input);
    return {
      resourceId: value.resourceId,
      operation: Operation.parse({
        name: "inspection.area",
        params: {
          region_wgs84: value.area.vertices.map((p) => ({
            longitude_deg: p.longitude,
            latitude_deg: p.latitude,
            ellipsoid_height_m: p.ellipsoidHeightM,
          })),
          task_timeout_ms: 300000,
          search_strategy: value.area.searchStrategy,
        },
      }),
    };
  }
  if (name === "simulation_apply_effect") {
    const value = z
      .object({
        resourceId: resource,
        targetId: z.unknown(),
        position: z.unknown(),
        observation: z.unknown(),
      })
      .strict()
      .parse(input);
    const { resourceId, ...params } = value;
    return { resourceId, operation: Operation.parse({ name: "simulation.applyEffect", params }) };
  }
  throw Error("ZMQ_CONSOLE_TOOL_UNKNOWN");
}
