import { z } from "zod";
import {
  BusinessObjectRefSchema,
  TaskBusinessIdentitySchema,
  type TaskBusinessIdentity,
} from "./task-business-contract.js";

export const TASK_BUSINESS_ARTIFACT_SCHEMA_VERSION = "sdar.task-artifact/1.0-rc2" as const;

const id = z.string().min(1).max(256);
const revision = z.number().int().positive();
const nonnegative = z.number().nonnegative();
const positive = z.number().positive();
const utc = z.iso.datetime({ offset: true });
const finite = z.number();
const longitude = finite.min(-180).max(180);
const latitude = finite.min(-90).max(90);

export const GeoPositionSchema = z.union([
  z.tuple([longitude, latitude]),
  z.tuple([longitude, latitude, finite]),
]);
export const LocalPositionSchema = z.union([
  z.tuple([finite, finite]),
  z.tuple([finite, finite, finite]),
]);

function samePosition(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((coordinate, i) => coordinate === b[i]);
}

function polygonRing(position: z.ZodType<number[]>) {
  return z
    .array(position)
    .min(4)
    .max(10_000)
    .refine((ring) => {
      const first = ring.at(0);
      const last = ring.at(-1);
      return first !== undefined && last !== undefined && samePosition(first, last);
    }, "POLYGON_RING_NOT_CLOSED")
    .refine(
      (ring) => new Set(ring.slice(0, -1).map((point) => point.join(","))).size >= 3,
      "POLYGON_RING_TOO_FEW_DISTINCT_POSITIONS",
    );
}

function geometry(position: z.ZodType<number[]>) {
  const line = z.array(position).min(2).max(10_000);
  const ring = polygonRing(position);
  const polygon = z.array(ring).min(1).max(100);
  return z.union([
    z.object({ type: z.literal("Point"), coordinates: position }).strict(),
    z
      .object({ type: z.literal("MultiPoint"), coordinates: z.array(position).min(1).max(10_000) })
      .strict(),
    z.object({ type: z.literal("LineString"), coordinates: line }).strict(),
    z
      .object({ type: z.literal("MultiLineString"), coordinates: z.array(line).min(1).max(100) })
      .strict(),
    z.object({ type: z.literal("Polygon"), coordinates: polygon }).strict(),
    z
      .object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygon).min(1).max(100) })
      .strict(),
  ]);
}

export const GeoGeometrySchema = geometry(GeoPositionSchema);
export const LocalGeometrySchema = geometry(LocalPositionSchema);

export const ObservationTimeSchema = z.discriminatedUnion("clockDomain", [
  z.object({ clockDomain: z.literal("utc"), observedAt: utc }).strict(),
  z
    .object({
      clockDomain: z.enum(["simulator_relative", "device_monotonic"]),
      elapsedMilliseconds: nonnegative,
      clockId: id,
    })
    .strict(),
]);

const imagePoint = z.discriminatedUnion("coordinateMode", [
  z.object({ coordinateMode: z.literal("pixel"), x: nonnegative, y: nonnegative }).strict(),
  z
    .object({
      coordinateMode: z.literal("normalized"),
      x: nonnegative.max(1),
      y: nonnegative.max(1),
    })
    .strict(),
]);
const imageBox = z.discriminatedUnion("coordinateMode", [
  z
    .object({
      coordinateMode: z.literal("pixel"),
      x: nonnegative,
      y: nonnegative,
      width: positive,
      height: positive,
    })
    .strict(),
  z
    .object({
      coordinateMode: z.literal("normalized"),
      x: nonnegative.max(1),
      y: nonnegative.max(1),
      width: positive.max(1),
      height: positive.max(1),
    })
    .strict()
    .refine((box) => box.x + box.width <= 1 && box.y + box.height <= 1, "IMAGE_BOX_OUT_OF_BOUNDS"),
]);

export const ArtifactContentSchema = z.union([
  z
    .object({
      kind: z.literal("geojson"),
      crs: z.literal("OGC:CRS84"),
      geometry: GeoGeometrySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("local_geometry"),
      frameId: id,
      unit: z.enum(["m", "cm", "mm"]),
      axisConvention: id,
      transformRef: id.optional(),
      geometry: LocalGeometrySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("image_observation"),
      imageRef: id.optional(),
      frameId: id,
      bbox: imageBox.optional(),
      point: imagePoint.optional(),
    })
    .strict()
    .refine(
      (content) => !!(content.imageRef ?? content.bbox ?? content.point),
      "IMAGE_EVIDENCE_MISSING",
    ),
  z.object({ kind: z.literal("structured"), value: z.record(id, z.unknown()) }).strict(),
  z
    .object({
      kind: z.literal("content_ref"),
      artifactId: id,
      revision,
      readMethod: z.literal("business_artifact_content"),
      handle: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
      mediaType: id,
      sizeBytes: z.number().int().nonnegative().max(1_000_000_000),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      expiresAt: utc.optional(),
    })
    .strict(),
]);
export type ArtifactContent = z.infer<typeof ArtifactContentSchema>;

export const ArtifactTypeSchema = z.enum([
  "navigation.destination",
  "navigation.route",
  "navigation.trajectory",
  "navigation.waypoints",
  "recon.area",
  "recon.coverage_plan",
  "recon.current_footprint",
  "recon.covered_area",
  "target.object",
  "target.track",
]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

const routeProperties = z
  .object({
    adoption: z.enum(["candidate", "adopted", "retired"]),
    purpose: z.enum(["navigation", "recon", "return"]),
    routeSource: id,
    routePlanId: id.optional(),
    distanceM: nonnegative.optional(),
    estimatedDurationSec: nonnegative.optional(),
    replanReasonCode: id.optional(),
  })
  .strict();
const grid = z
  .object({
    frameId: id,
    origin: z.tuple([finite, finite]),
    cellSizeM: positive,
    denominatorCellCount: z.number().int().positive(),
  })
  .strict();
const targetProperties = z
  .object({
    targetId: id,
    targetType: id.optional(),
    confidence: nonnegative.max(1).optional(),
    visibility: z.enum(["visible", "lost", "unknown"]),
    trackingState: z.enum(["unlocked", "locking", "locked", "lost", "unknown"]),
    firstSeen: ObservationTimeSchema,
    lastSeen: ObservationTimeSchema,
    sensorId: id,
    observationSessionId: id,
    lastSeenPositionQuality: z.enum(["observed", "derived", "unknown"]),
  })
  .strict();

const propertySchemas = {
  "navigation.destination": z.object({ intent: z.enum(["requested", "adopted"]) }).strict(),
  "navigation.route": routeProperties,
  "navigation.trajectory": z.object({ sampleCount: z.number().int().nonnegative() }).strict(),
  "navigation.waypoints": z
    .object({ ordered: z.literal(true), waypointCount: z.number().int().nonnegative() })
    .strict(),
  "recon.area": z.object({ areaRevision: revision }).strict(),
  "recon.coverage_plan": z
    .object({ areaRevision: revision, grid, adoption: z.enum(["candidate", "adopted", "retired"]) })
    .strict(),
  "recon.current_footprint": z
    .object({
      areaRevision: revision,
      quality: z.enum(["observed", "nominal", "estimated"]),
      model: id.optional(),
    })
    .strict(),
  "recon.covered_area": z
    .object({
      areaRevision: revision,
      grid,
      numeratorCellCount: z.number().int().nonnegative(),
    })
    .strict(),
  "target.object": targetProperties,
  "target.track": z.object({ targetId: id, sampleCount: z.number().int().nonnegative() }).strict(),
} satisfies Record<ArtifactType, z.ZodType>;
export const ArtifactPropertiesSchema = z.union([
  propertySchemas["navigation.destination"],
  propertySchemas["navigation.route"],
  propertySchemas["navigation.trajectory"],
  propertySchemas["navigation.waypoints"],
  propertySchemas["recon.area"],
  propertySchemas["recon.coverage_plan"],
  propertySchemas["recon.current_footprint"],
  propertySchemas["recon.covered_area"],
  propertySchemas["target.object"],
  propertySchemas["target.track"],
]);

const common = {
  schemaVersion: z.literal(TASK_BUSINESS_ARTIFACT_SCHEMA_VERSION),
  artifactId: id,
  artifactType: ArtifactTypeSchema,
  revision,
  semantics: z.enum(["requested", "planned", "observed", "derived"]),
  lifecycle: z.enum(["active", "invalidated", "superseded", "archived"]),
  identity: TaskBusinessIdentitySchema,
  source: z
    .object({
      producer: z.enum(["device", "device_planner", "provider", "agent", "simulator_sensor"]),
      sourceRecordRef: id.optional(),
      sourceRevision: id.optional(),
      method: id.optional(),
    })
    .strict(),
  createdAt: utc,
  updatedAt: utc,
  validUntil: utc.optional(),
  relations: z
    .array(
      z
        .object({
          relationType: id,
          target: z.union([
            BusinessObjectRefSchema,
            z.object({ externalType: id, externalId: id }).strict(),
          ]),
        })
        .strict(),
    )
    .max(100)
    .optional(),
  evidenceRefs: z.array(id).max(100).optional(),
};

const available = z
  .object({
    ...common,
    availability: z.literal("available"),
    content: ArtifactContentSchema,
    properties: ArtifactPropertiesSchema,
    representations: z.record(id, ArtifactContentSchema).optional(),
  })
  .strict();
const empty = z
  .object({
    ...common,
    availability: z.literal("empty"),
    reasonCode: id,
    readPerformedAt: utc,
    properties: ArtifactPropertiesSchema.optional(),
  })
  .strict();
const absent = z
  .object({
    ...common,
    availability: z.enum(["not_produced_yet", "unavailable", "not_supported"]),
    reasonCode: id,
    properties: ArtifactPropertiesSchema.optional(),
  })
  .strict();

const expectedGeometry: Record<ArtifactType, readonly string[]> = {
  "navigation.destination": ["Point"],
  "navigation.route": ["LineString", "MultiLineString"],
  "navigation.trajectory": ["Point", "LineString", "MultiLineString"],
  "navigation.waypoints": ["MultiPoint"],
  "recon.area": ["Polygon", "MultiPolygon"],
  "recon.coverage_plan": ["Polygon", "MultiPolygon"],
  "recon.current_footprint": ["Polygon", "MultiPolygon"],
  "recon.covered_area": ["Polygon", "MultiPolygon"],
  "target.object": ["Point"],
  "target.track": ["LineString", "MultiLineString", "MultiPoint"],
};
const semanticsByType: Record<ArtifactType, readonly string[]> = {
  "navigation.destination": ["requested", "planned"],
  "navigation.route": ["planned"],
  "navigation.trajectory": ["observed"],
  "navigation.waypoints": ["requested", "planned"],
  "recon.area": ["requested", "planned"],
  "recon.coverage_plan": ["planned"],
  "recon.current_footprint": ["observed", "derived"],
  "recon.covered_area": ["derived"],
  "target.object": ["observed", "derived"],
  "target.track": ["observed", "derived"],
};

export const TaskArtifactSchema = z
  .discriminatedUnion("availability", [available, empty, absent])
  .superRefine((artifact, ctx) => {
    const properties =
      artifact.properties === undefined
        ? null
        : propertySchemas[artifact.artifactType].safeParse(artifact.properties);
    if (properties && !properties.success) {
      ctx.addIssue({
        code: "custom",
        message: "ARTIFACT_PROPERTIES_INVALID",
        path: ["properties"],
      });
    }
    if (!semanticsByType[artifact.artifactType].includes(artifact.semantics)) {
      ctx.addIssue({ code: "custom", message: "ARTIFACT_SEMANTICS_INVALID", path: ["semantics"] });
    }
    if (artifact.artifactType === "recon.current_footprint") {
      const props = propertySchemas["recon.current_footprint"].safeParse(artifact.properties);
      if (props.success && props.data.quality !== "observed" && !props.data.model) {
        ctx.addIssue({
          code: "custom",
          message: "FOOTPRINT_MODEL_REQUIRED",
          path: ["properties", "model"],
        });
      }
      if (
        props.success &&
        ((props.data.quality === "observed" && artifact.semantics !== "observed") ||
          (props.data.quality !== "observed" && artifact.semantics !== "derived"))
      ) {
        ctx.addIssue({
          code: "custom",
          message: "FOOTPRINT_SEMANTICS_MISMATCH",
          path: ["semantics"],
        });
      }
    }
    if (artifact.artifactType === "recon.covered_area") {
      const props = propertySchemas["recon.covered_area"].safeParse(artifact.properties);
      if (props.success && props.data.numeratorCellCount > props.data.grid.denominatorCellCount) {
        ctx.addIssue({
          code: "custom",
          message: "COVERAGE_EXCEEDS_DENOMINATOR",
          path: ["properties"],
        });
      }
    }
    if (artifact.availability !== "available") return;
    if (artifact.artifactType === "target.object") {
      const props = propertySchemas["target.object"].safeParse(artifact.properties);
      if (props.success && props.data.targetId !== artifact.artifactId) {
        ctx.addIssue({
          code: "custom",
          message: "TARGET_ID_MISMATCH",
          path: ["properties", "targetId"],
        });
      }
    }
    if (artifact.artifactType === "navigation.trajectory") {
      const props = propertySchemas["navigation.trajectory"].safeParse(artifact.properties);
      const geometryType =
        artifact.content.kind === "geojson" || artifact.content.kind === "local_geometry"
          ? artifact.content.geometry.type
          : undefined;
      if (
        props.success &&
        ((geometryType === "Point" && props.data.sampleCount !== 1) ||
          (geometryType !== "Point" && props.data.sampleCount < 2))
      ) {
        ctx.addIssue({
          code: "custom",
          message: "TRAJECTORY_SAMPLE_GEOMETRY_MISMATCH",
          path: ["properties", "sampleCount"],
        });
      }
    }
    if (artifact.artifactType === "target.track") {
      const props = propertySchemas["target.track"].safeParse(artifact.properties);
      if (props.success && props.data.sampleCount < 2) {
        ctx.addIssue({
          code: "custom",
          message: "TARGET_TRACK_TOO_FEW_SAMPLES",
          path: ["properties", "sampleCount"],
        });
      }
    }
    if (artifact.artifactType === "navigation.waypoints") {
      const props = propertySchemas["navigation.waypoints"].safeParse(artifact.properties);
      if (props.success && props.data.waypointCount < 1) {
        ctx.addIssue({
          code: "custom",
          message: "WAYPOINTS_EMPTY",
          path: ["properties", "waypointCount"],
        });
      }
    }
    if (artifact.content.kind === "content_ref") {
      if (
        artifact.content.artifactId !== artifact.artifactId ||
        artifact.content.revision !== artifact.revision
      ) {
        ctx.addIssue({
          code: "custom",
          message: "CONTENT_REF_VERSION_MISMATCH",
          path: ["content"],
        });
      }
    } else if (artifact.content.kind === "geojson" || artifact.content.kind === "local_geometry") {
      if (!expectedGeometry[artifact.artifactType].includes(artifact.content.geometry.type)) {
        ctx.addIssue({
          code: "custom",
          message: "ARTIFACT_GEOMETRY_TYPE_INVALID",
          path: ["content", "geometry", "type"],
        });
      }
    } else if (
      artifact.content.kind === "image_observation" &&
      artifact.artifactType !== "target.object"
    ) {
      ctx.addIssue({ code: "custom", message: "IMAGE_CONTENT_ONLY_FOR_TARGET", path: ["content"] });
    } else if (artifact.content.kind === "structured") {
      ctx.addIssue({
        code: "custom",
        message: "SPATIAL_ARTIFACT_REQUIRES_SPATIAL_CONTENT",
        path: ["content"],
      });
    }
    for (const [name, representation] of Object.entries(artifact.representations ?? {})) {
      if (
        representation.kind === "content_ref" &&
        (representation.artifactId !== artifact.artifactId ||
          representation.revision !== artifact.revision)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "REPRESENTATION_REF_VERSION_MISMATCH",
          path: ["representations", name],
        });
      }
    }
  });
export type TaskArtifact = z.infer<typeof TaskArtifactSchema>;

export type PreparedArtifactContentRead =
  | { kind: "inline"; content: Exclude<ArtifactContent, { kind: "content_ref" }> }
  | { kind: "stored"; handle: string; mediaType: string; sizeBytes: number; sha256: string };

/** Called after the store selects one immutable version; never accepts a caller URL. */
export function prepareArtifactContentRead(
  storedArtifact: TaskArtifact,
  request: { identity: TaskBusinessIdentity; artifactId: string; revision: number },
  now: Date,
  representationName?: string,
): PreparedArtifactContentRead {
  const artifact = TaskArtifactSchema.parse(storedArtifact);
  const identity = TaskBusinessIdentitySchema.parse(request.identity);
  if (
    artifact.identity.taskId !== identity.taskId ||
    artifact.identity.executionId !== identity.executionId ||
    artifact.identity.providerId !== identity.providerId ||
    artifact.identity.resourceId !== identity.resourceId ||
    artifact.identity.operationName !== identity.operationName
  ) {
    throw new Error("ARTIFACT_SCOPE_MISMATCH");
  }
  if (artifact.artifactId !== request.artifactId || artifact.revision !== request.revision) {
    throw new Error("ARTIFACT_REVISION_NOT_FOUND");
  }
  if (artifact.availability !== "available") throw new Error("ARTIFACT_NOT_AVAILABLE");
  const content =
    representationName === undefined
      ? artifact.content
      : artifact.representations?.[representationName];
  if (!content) throw new Error("ARTIFACT_REPRESENTATION_NOT_FOUND");
  if (content.kind !== "content_ref") return { kind: "inline", content };
  if (!Number.isFinite(now.getTime())) throw new Error("ARTIFACT_READ_TIME_INVALID");
  if (content.expiresAt && now.getTime() >= Date.parse(content.expiresAt)) {
    throw new Error("ARTIFACT_CONTENT_EXPIRED");
  }
  return {
    kind: "stored",
    handle: content.handle,
    mediaType: content.mediaType,
    sizeBytes: content.sizeBytes,
    sha256: content.sha256,
  };
}

// Zod's tuple JSON Schema currently emits prefixItems without exact array bounds.
// Add those bounds so JSON Schema consumers reject extra/missing coordinates too.
function enforceTupleBounds(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(enforceTupleBounds);
    return;
  }
  if (!node || typeof node !== "object") return;
  const object = node as Record<string, unknown>;
  if (Array.isArray(object.prefixItems)) {
    object.minItems = object.prefixItems.length;
    object.maxItems = object.prefixItems.length;
    object.items = false;
  }
  Object.values(object).forEach(enforceTupleBounds);
}

export function taskBusinessArtifactJsonSchema(): object {
  const schema = z.toJSONSchema(TaskArtifactSchema);
  enforceTupleBounds(schema);
  return schema;
}
