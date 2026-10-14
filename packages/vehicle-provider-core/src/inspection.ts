import { z } from "zod";

export const INSPECTION_OPERATION = "vehicle_inspect_area" as const;
export const INSPECTION_VERSION = "1.0" as const;
export const INSPECTION_MAX_ELAPSED_MS = 300_000;
export const INSPECTION_MAX_FINDINGS = 256;

export function isReconOperation(operationName: string): boolean {
  return operationName === "vehicle_area_recon" || operationName === INSPECTION_OPERATION;
}

const point = z
  .object({ x: z.number().min(-180).max(180), y: z.number().min(-90).max(90) })
  .strict();
export const InspectionInputSchema = z
  .object({
    resourceId: z.string().min(1).max(256),
    area: z
      .object({
        boundary: z.array(point).min(3).max(257),
        frame: z.enum(["WGS84", "EPSG:4326"]).optional(),
        excludedZones: z.array(z.string().min(1).max(256)).max(128).optional(),
      })
      .strict(),
  })
  .strict();
export type InspectionInput = z.infer<typeof InspectionInputSchema>;
type Point = z.infer<typeof point>;

export class InspectionInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "InspectionInputError";
  }
}

const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const onSegment = (a: Point, b: Point, p: Point) =>
  cross(a, b, p) === 0 &&
  p.x >= Math.min(a.x, b.x) &&
  p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) &&
  p.y <= Math.max(a.y, b.y);
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const x = cross(a, b, c),
    y = cross(a, b, d),
    u = cross(c, d, a),
    v = cross(c, d, b);
  return (
    (Math.sign(x) !== Math.sign(y) && Math.sign(u) !== Math.sign(v)) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}

/** The wire contract fixes x=longitude/y=latitude; local frames are never guessed. */
export function parseInspectionInput(value: unknown): InspectionInput {
  const raw = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const area =
    raw.area !== null && typeof raw.area === "object" ? (raw.area as Record<string, unknown>) : {};
  if (area.frame !== undefined && area.frame !== "WGS84" && area.frame !== "EPSG:4326")
    throw new InspectionInputError("UGV_INSPECTION_CRS_UNSUPPORTED");
  if (Array.isArray(area.excludedZones) && area.excludedZones.length)
    throw new InspectionInputError("UGV_INSPECTION_EXCLUSIONS_UNRESOLVED");
  const parsed = InspectionInputSchema.safeParse(value);
  if (!parsed.success) throw new InspectionInputError("UGV_INSPECTION_AREA_INVALID");
  const input = parsed.data;
  const polygon = [...input.area.boundary];
  if (polygon.length > 3 && same(pointAt(polygon, 0), pointAt(polygon, polygon.length - 1)))
    polygon.pop();
  if (
    polygon.length < 3 ||
    polygon.length > 256 ||
    new Set(polygon.map((p) => `${p.x},${p.y}`)).size !== polygon.length
  )
    throw new InspectionInputError("UGV_INSPECTION_AREA_INVALID");
  const first = pointAt(polygon, 0);
  let twiceArea = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = pointAt(polygon, i),
      b = pointAt(polygon, (i + 1) % polygon.length);
    // A single local UGV region cannot silently change its meaning across the antimeridian.
    if (Math.abs(a.x - b.x) > 180) throw new InspectionInputError("UGV_INSPECTION_AREA_INVALID");
    twiceArea += cross(first, a, b);
    for (let j = i + 1; j < polygon.length; j++) {
      if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
      if (intersects(a, b, pointAt(polygon, j), pointAt(polygon, (j + 1) % polygon.length)))
        throw new InspectionInputError("UGV_INSPECTION_AREA_INVALID");
    }
  }
  if (twiceArea === 0) throw new InspectionInputError("UGV_INSPECTION_AREA_INVALID");
  return { ...input, area: { ...input.area, boundary: polygon, frame: "WGS84" } };
}

export function inspectionReconArguments(value: unknown): Record<string, unknown> {
  const input = parseInspectionInput(value);
  return {
    resourceId: input.resourceId,
    scanMode: "area",
    scanCount: 1,
    area: { polygon: input.area.boundary.map((p) => ({ longitude: p.x, latitude: p.y })) },
  };
}

export function inspectionPointInArea(input: InspectionInput, location: Point): boolean {
  let inside = false;
  const points = input.area.boundary;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = pointAt(points, i),
      b = pointAt(points, j);
    if (onSegment(a, b, location)) return true;
    if (
      a.y > location.y !== b.y > location.y &&
      location.x < ((b.x - a.x) * (location.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const InspectionFindingSchema = z.record(z.string(), primitive);
export const InspectionReportSchema = z
  .object({
    version: z.literal(INSPECTION_VERSION),
    completion: z.enum(["complete", "partial", "unavailable"]),
    targetReportObservedAt: z.iso.datetime().nullable(),
    targetReportComplete: z.boolean(),
    coverageState: z.enum(["full", "partial", "none", "unknown"]),
    findingCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    artifactRefs: z
      .array(
        z
          .object({
            kind: z.literal("artifact"),
            id: z.string(),
            revision: z.number().int().positive(),
          })
          .strict(),
      )
      .max(256),
  })
  .strict();

export function inspectionSchemas(resourceId: string) {
  const input = z.toJSONSchema(InspectionInputSchema);
  if (!input.properties) throw new InspectionInputError("UGV_INSPECTION_SCHEMA_INVALID");
  input.properties.resourceId = { type: "string", const: resourceId };
  return {
    input,
    result: {
      type: "object",
      additionalProperties: false,
      required: [
        "resourceId",
        "status",
        "observedAt",
        "anomalies",
        "inspectionReport",
        "coverage",
        "correlationStrength",
        "missingEvidence",
      ],
      properties: {
        resourceId: { type: "string", const: resourceId },
        status: { type: "string", enum: ["completed", "failed", "cancelled", "timeout"] },
        observedAt: { type: "string", format: "date-time" },
        anomalies: { type: "array", maxItems: 256, items: z.toJSONSchema(InspectionFindingSchema) },
        inspectionReport: z.toJSONSchema(InspectionReportSchema),
        coverage: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
        correlationStrength: {
          type: "string",
          enum: [
            "STRICT_CORRELATED",
            "INFERRED_CURRENT_EXECUTION",
            "WEAK_UNCORRELATED",
            "MISMATCH",
            "UNKNOWN",
          ],
        },
        missingEvidence: { type: "array", items: { type: "string" } },
      },
    },
  };
}

function pointAt(points: readonly Point[], index: number): Point {
  const value = points[index];
  if (value === undefined) throw new InspectionInputError("UGV_INSPECTION_AREA_INVALID");
  return value;
}
