import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { AdapterBusinessEvent } from "../../../packages/adapter-protocol/src/index.js";
import {
  BoundExecutionScope,
  scopeBusinessIdentity,
  type ProviderExecution,
  type TaskBusinessStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
} from "../../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  ArtifactContentSchema,
  TaskArtifactSchema,
} from "../../../packages/vehicle-provider-core/src/task-business-artifact.js";
import {
  compareIsoTimestamps,
  millisecondsBetweenIsoTimestamps,
} from "../../../packages/vehicle-provider-core/src/time.js";

const id = z.string().min(1).max(256);
const source = {
  schemaVersion: z.literal("ugv.recon-footprint-fact/1"),
  missionId: id,
  areaRevision: z.number().int().positive(),
  sourceRecordId: id,
  sourceRevision: z.number().int().positive(),
  observedAt: z.iso.datetime({ offset: true }),
};
const geometry = ArtifactContentSchema.refine(
  (content) =>
    (content.kind === "geojson" || content.kind === "local_geometry") &&
    (content.geometry.type === "Polygon" || content.geometry.type === "MultiPolygon"),
  "FOOTPRINT_POLYGON_REQUIRED",
);
const footprintFactSchema = z.discriminatedUnion("state", [
  z
    .object({
      ...source,
      state: z.literal("active"),
      quality: z.enum(["observed", "nominal", "estimated"]),
      sourceKind: z.enum(["device_reported", "calibrated_model"]),
      modelRef: id.optional(),
      content: geometry,
    })
    .strict()
    .superRefine((fact, ctx) => {
      if (fact.quality === "observed" && fact.sourceKind !== "device_reported")
        ctx.addIssue({ code: "custom", message: "FOOTPRINT_OBSERVED_SOURCE_INVALID" });
      if (fact.quality !== "observed" && (fact.sourceKind !== "calibrated_model" || !fact.modelRef))
        ctx.addIssue({ code: "custom", message: "FOOTPRINT_MODEL_REQUIRED" });
      if (
        fact.quality !== "observed" &&
        fact.content.kind === "local_geometry" &&
        !fact.content.transformRef
      )
        ctx.addIssue({ code: "custom", message: "FOOTPRINT_TRANSFORM_VERSION_REQUIRED" });
    }),
  z
    .object({
      ...source,
      state: z.enum(["paused", "ended", "camera_fault"]),
    })
    .strict(),
]);
export type ReconFootprintFact = z.infer<typeof footprintFactSchema>;

const terminal = new Set(["SUCCEEDED", "BUSINESS_FAILED", "CANCELLED", "TECHNICAL_FAILED"]);

/** Accepts actual reported or calibrated footprint geometry; no FOV is inferred here. */
export class FootprintBusinessProcessor {
  constructor(
    readonly business: Pick<
      TaskBusinessStore,
      "getContext" | "getArtifactLatest" | "getObjectVersion" | "commitBusinessChangeSet"
    >,
    readonly notifyCommitted: (event: AdapterBusinessEvent) => void,
  ) {}

  async apply(execution: ProviderExecution, input: unknown): Promise<"committed" | "duplicate"> {
    const fact = footprintFactSchema.parse(input);
    if (
      execution.operationName !== "vehicle_area_recon" ||
      execution.taskBusinessContextExpected !== true ||
      execution.downstreamMissionIds.at(-1) !== fact.missionId ||
      compareIsoTimestamps(fact.observedAt, execution.createdAt) < 0
    )
      throw new Error("FOOTPRINT_EXECUTION_BINDING_INVALID");
    if (terminal.has(execution.state)) throw new Error("FOOTPRINT_TASK_TERMINAL");
    const scope = BoundExecutionScope.fromExecution(execution);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.business.getContext(scope);
      if (!current || current.summary.status === "finalized")
        throw new Error("FOOTPRINT_CONTEXT_UNAVAILABLE");
      const effectiveAreaRef = current.activeRefs.reconEffectiveArea;
      if (
        effectiveAreaRef &&
        (effectiveAreaRef.kind !== "artifact" || effectiveAreaRef.id !== "recon-requested-area")
      ) {
        throw new Error("FOOTPRINT_EFFECTIVE_AREA_REF_INVALID");
      }
      // The latest area Artifact may be only a candidate, not the adopted area.
      const areaVersion = await this.business.getObjectVersion(
        scope,
        effectiveAreaRef ?? { kind: "artifact", id: "recon-requested-area", revision: 1 },
      );
      const effectiveArea =
        areaVersion?.kind === "artifact" &&
        areaVersion.value.artifactType === "recon.area" &&
        areaVersion.value.availability === "available"
          ? areaVersion.value
          : undefined;
      if (
        !effectiveArea &&
        execution.arguments.scanMode !== "circular" &&
        execution.arguments.scanMode !== 2
      ) {
        throw new Error("FOOTPRINT_EFFECTIVE_AREA_REF_INVALID");
      }
      if (effectiveAreaRef && effectiveArea?.semantics !== "planned") {
        throw new Error("FOOTPRINT_EFFECTIVE_AREA_REF_INVALID");
      }
      const rawAreaRevision =
        effectiveArea && "areaRevision" in effectiveArea.properties
          ? effectiveArea.properties.areaRevision
          : undefined;
      const effectiveAreaRevision = rawAreaRevision ?? 1;
      if (
        typeof effectiveAreaRevision !== "number" ||
        !Number.isInteger(effectiveAreaRevision) ||
        effectiveAreaRevision < 1
      ) {
        throw new Error("FOOTPRINT_AREA_REVISION_INVALID");
      }
      if (fact.areaRevision !== effectiveAreaRevision)
        throw new Error("FOOTPRINT_AREA_REVISION_MISMATCH");
      const previous = await this.business.getArtifactLatest(scope, "recon-current-footprint");
      if (previous && previous.artifactType !== "recon.current_footprint")
        throw new Error("FOOTPRINT_ARTIFACT_ID_CONFLICT");
      // A later source revision alone cannot invalidate a newer physical observation.
      if (previous && compareIsoTimestamps(fact.observedAt, previous.updatedAt) < 0)
        return "duplicate";
      const previousSourceRevision =
        previous?.source.sourceRevision === undefined
          ? undefined
          : Number(previous.source.sourceRevision);
      if (previousSourceRevision !== undefined && fact.sourceRevision < previousSourceRevision)
        return "duplicate";
      if (previous && previousSourceRevision === fact.sourceRevision) {
        if (previous.source.sourceRecordRef !== fact.sourceRecordId)
          throw new Error("FOOTPRINT_SOURCE_VERSION_CONFLICT");
        if (fact.state !== "active") {
          if (previous.availability !== "available") return "duplicate";
        } else if (
          previous.availability === "available" &&
          isDeepStrictEqual(previous.content, fact.content) &&
          "quality" in previous.properties &&
          previous.properties.quality === fact.quality
        )
          return "duplicate";
        else throw new Error("FOOTPRINT_SOURCE_VERSION_CONFLICT");
      }
      if (fact.state !== "active" && previous?.availability !== "available") return "duplicate";
      if (
        fact.state === "active" &&
        previous?.availability === "available" &&
        millisecondsBetweenIsoTimestamps(fact.observedAt, previous.updatedAt) < 500
      )
        return "duplicate";
      const revision = (previous?.revision ?? 0) + 1;
      const artifact = TaskArtifactSchema.parse({
        schemaVersion: "sdar.task-artifact/1.0-rc2",
        artifactId: "recon-current-footprint",
        artifactType: "recon.current_footprint",
        revision,
        semantics: fact.state === "active" && fact.quality === "observed" ? "observed" : "derived",
        lifecycle: fact.state === "active" ? "active" : "invalidated",
        identity: scopeBusinessIdentity(scope),
        source: {
          producer:
            fact.state === "active" && fact.sourceKind === "device_reported"
              ? "device"
              : "provider",
          sourceRecordRef: fact.sourceRecordId,
          sourceRevision: String(fact.sourceRevision),
          method: fact.state === "active" ? fact.sourceKind : fact.state,
        },
        createdAt: previous?.createdAt ?? fact.observedAt,
        updatedAt: fact.observedAt,
        ...(fact.state === "active"
          ? {
              availability: "available",
              properties: {
                areaRevision: fact.areaRevision,
                quality: fact.quality,
                ...(fact.modelRef === undefined ? {} : { model: fact.modelRef }),
              },
              content: fact.content,
            }
          : { availability: "unavailable", reasonCode: `FOOTPRINT_${fact.state.toUpperCase()}` }),
      });
      const ref = { kind: "artifact" as const, id: artifact.artifactId, revision };
      const activeRefs = { ...current.activeRefs };
      if (fact.state === "active") activeRefs.currentFootprint = ref;
      else delete activeRefs.currentFootprint;
      const context = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        artifactRefs: [...current.artifactRefs, ref],
        activeRefs,
        updatedAt:
          compareIsoTimestamps(fact.observedAt, current.updatedAt) >= 0
            ? fact.observedAt
            : current.updatedAt,
      });
      const reasonCode = fact.state === "active" ? "FOOTPRINT_OBSERVED" : "FOOTPRINT_INVALIDATED";
      const body = TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "ARTIFACT_CHANGED",
        contextRevision: context.contextRevision,
        providerRecordedAt: fact.observedAt,
        payload: {
          change: fact.state === "active" ? (previous ? "update" : "create") : "invalidate",
          artifactRef: ref,
          ...(previous === undefined ? {} : { previousRevision: previous.revision }),
          reasonCode,
        },
      });
      try {
        const committed = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: current.contextRevision,
            context,
            objects: [{ kind: "artifact", value: artifact }],
          },
          [{ body, description: reasonCode, reasonCode, severityHint: "info" }],
        );
        for (const event of committed.events) this.notifyCommitted(event);
        return "committed";
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "BUSINESS_CONTEXT_REVISION_CONFLICT" ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new Error("FOOTPRINT_RETRY_EXHAUSTED");
  }
}
