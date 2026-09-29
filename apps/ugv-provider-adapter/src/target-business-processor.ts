import { createHash } from "node:crypto";
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
  TaskArtifactSchema,
  type TaskArtifact,
} from "../../../packages/vehicle-provider-core/src/task-business-artifact.js";
import { compareIsoTimestamps } from "../../../packages/vehicle-provider-core/src/time.js";

const id = z.string().min(1).max(256);
const targetFactSchema = z
  .object({
    schemaVersion: z.literal("ugv.recon-target-fact/1"),
    missionId: id,
    observationSessionId: id,
    sensorId: id,
    sourceTargetId: id,
    sourceRevision: id,
    observedAt: z.iso.datetime({ offset: true }),
    visibility: z.enum(["visible", "lost", "unknown"]),
    trackingState: z.enum(["unlocked", "locking", "locked", "lost", "unknown"]),
    targetType: id.optional(),
    confidence: z.number().min(0).max(1).optional(),
    location: z
      .object({
        longitude: z.number().min(-180).max(180),
        latitude: z.number().min(-90).max(90),
        altitude: z.number().optional(),
      })
      .strict()
      .optional(),
    pixel: z
      .object({
        x: z.number().nonnegative(),
        y: z.number().nonnegative(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ReconTargetFact = z.infer<typeof targetFactSchema>;

const terminal = new Set(["SUCCEEDED", "BUSINESS_FAILED", "CANCELLED", "TECHNICAL_FAILED"]);
const captureRevision = (value: unknown): bigint | undefined =>
  typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : undefined;

/** One scoped object per source target; never globally merges targets across sessions. */
export class TargetBusinessProcessor {
  constructor(
    readonly business: Pick<
      TaskBusinessStore,
      "getContext" | "getArtifactLatest" | "getArtifactVersion" | "commitBusinessChangeSet"
    >,
    readonly notifyCommitted: (event: AdapterBusinessEvent) => void,
  ) {}

  async apply(execution: ProviderExecution, input: unknown): Promise<"committed" | "duplicate"> {
    const fact = targetFactSchema.parse(input);
    if (
      execution.operationName !== "vehicle_area_recon" ||
      execution.taskBusinessContextExpected !== true ||
      execution.downstreamMissionIds.at(-1) !== fact.missionId ||
      fact.observationSessionId !== fact.missionId ||
      compareIsoTimestamps(fact.observedAt, execution.createdAt) < 0
    )
      throw new Error("TARGET_EXECUTION_SESSION_BINDING_INVALID");
    if (terminal.has(execution.state)) throw new Error("TARGET_TASK_TERMINAL");
    const scope = BoundExecutionScope.fromExecution(execution);
    const artifactId = `target-${createHash("sha256")
      .update(
        JSON.stringify([
          execution.externalExecutionId,
          fact.observationSessionId,
          fact.sensorId,
          fact.sourceTargetId,
        ]),
      )
      .digest("hex")
      .slice(0, 32)}`;
    const trackKey = `targetTrack:${artifactId}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.business.getContext(scope);
      if (!current || current.summary.status === "finalized")
        throw new Error("TARGET_CONTEXT_UNAVAILABLE");
      const previous = await this.business.getArtifactLatest(scope, artifactId);
      if (previous && previous.artifactType !== "target.object")
        throw new Error("TARGET_ARTIFACT_ID_CONFLICT");
      if (previous === undefined && fact.visibility !== "visible")
        throw new Error("TARGET_LOSS_WITHOUT_OBSERVATION");
      if (previous && compareIsoTimestamps(fact.observedAt, previous.updatedAt) < 0)
        return "duplicate";
      const geo =
        fact.location === undefined
          ? undefined
          : {
              kind: "geojson" as const,
              crs: "OGC:CRS84" as const,
              geometry: {
                type: "Point" as const,
                coordinates:
                  fact.location.altitude === undefined
                    ? [fact.location.longitude, fact.location.latitude]
                    : [fact.location.longitude, fact.location.latitude, fact.location.altitude],
              },
            };
      const image =
        fact.pixel === undefined
          ? undefined
          : {
              kind: "image_observation" as const,
              frameId: `${fact.sensorId}.pixel`,
              ...(fact.pixel.width === undefined || fact.pixel.height === undefined
                ? {
                    point: {
                      coordinateMode: "pixel" as const,
                      x: fact.pixel.x,
                      y: fact.pixel.y,
                    },
                  }
                : {
                    bbox: {
                      coordinateMode: "pixel" as const,
                      x: fact.pixel.x,
                      y: fact.pixel.y,
                      width: fact.pixel.width,
                      height: fact.pixel.height,
                    },
                  }),
            };
      const previousVisibility =
        previous?.properties !== undefined && "visibility" in previous.properties
          ? previous.properties.visibility
          : undefined;
      // A lost target keeps its last measured position, with the older lastSeen
      // and explicit lost visibility. It is never presented as a fresh sighting.
      const content =
        fact.visibility === "visible"
          ? (geo ?? image)
          : previous?.availability === "available"
            ? previous.content
            : undefined;
      const priorProperties =
        previous?.properties !== undefined && "firstSeen" in previous.properties
          ? previous.properties
          : undefined;
      const properties = {
        targetId: artifactId,
        ...(fact.targetType === undefined ? {} : { targetType: fact.targetType }),
        ...(fact.confidence === undefined ? {} : { confidence: fact.confidence }),
        visibility: fact.visibility,
        trackingState: fact.trackingState,
        firstSeen: priorProperties?.firstSeen ?? {
          clockDomain: "utc",
          observedAt: fact.observedAt,
        },
        lastSeen:
          fact.visibility === "visible"
            ? { clockDomain: "utc", observedAt: fact.observedAt }
            : (priorProperties?.lastSeen ?? { clockDomain: "utc", observedAt: fact.observedAt }),
        sensorId: fact.sensorId,
        observationSessionId: fact.observationSessionId,
        lastSeenPositionQuality:
          fact.visibility === "visible"
            ? geo === undefined
              ? "unknown"
              : "observed"
            : (priorProperties?.lastSeenPositionQuality ?? "unknown"),
      };
      if (previous?.source.sourceRevision === fact.sourceRevision) {
        if (
          previous.source.sourceRecordRef !== fact.sourceTargetId ||
          previous.availability !== (content === undefined ? "unavailable" : "available") ||
          !isDeepStrictEqual(previous.properties, properties) ||
          (previous.availability === "available" && !isDeepStrictEqual(previous.content, content))
        )
          throw new Error("TARGET_SOURCE_VERSION_CONFLICT");
        return "duplicate";
      }
      const previousCapture = captureRevision(previous?.source.sourceRevision);
      const incomingCapture = captureRevision(fact.sourceRevision);
      if (
        previousCapture !== undefined &&
        incomingCapture !== undefined &&
        incomingCapture < previousCapture
      )
        return "duplicate";
      const revision = (previous?.revision ?? 0) + 1;
      const artifact = TaskArtifactSchema.parse({
        schemaVersion: "sdar.task-artifact/1.0-rc2",
        artifactId,
        artifactType: "target.object",
        revision,
        semantics: "observed",
        lifecycle: "active",
        identity: scopeBusinessIdentity(scope),
        source: {
          producer: "device",
          sourceRecordRef: fact.sourceTargetId,
          sourceRevision: fact.sourceRevision,
          method: "mqtt_area_recon_targets",
        },
        createdAt: previous?.createdAt ?? fact.observedAt,
        updatedAt: fact.observedAt,
        relations: [
          {
            relationType: "source_target",
            target: { externalType: fact.sensorId, externalId: fact.sourceTargetId },
          },
        ],
        ...(content === undefined
          ? {
              availability: "unavailable",
              reasonCode: "TARGET_SPATIAL_EXPRESSION_UNAVAILABLE",
              properties,
            }
          : {
              availability: "available",
              properties,
              content,
              ...(fact.visibility === "visible"
                ? geo === undefined || image === undefined
                  ? {}
                  : { representations: { image } }
                : previous?.availability === "available" && previous.representations !== undefined
                  ? { representations: previous.representations }
                  : {}),
            }),
      });
      const ref = { kind: "artifact" as const, id: artifact.artifactId, revision };
      let activeRefs = { ...current.activeRefs };
      const priorTrackRef = current.activeRefs[trackKey];
      let track: TaskArtifact | undefined;
      const previousGeoPoint =
        previousVisibility === "visible" &&
        previous?.availability === "available" &&
        previous.content.kind === "geojson" &&
        previous.content.geometry.type === "Point"
          ? previous.content.geometry.coordinates
          : undefined;
      const sameObservationTime =
        fact.visibility === "visible" &&
        previous !== undefined &&
        previousGeoPoint !== undefined &&
        geo !== undefined &&
        compareIsoTimestamps(fact.observedAt, previous.updatedAt) === 0;
      if (sameObservationTime && !isDeepStrictEqual(previousGeoPoint, geo.geometry.coordinates))
        throw new Error("TARGET_SAME_TIME_POSITION_CONFLICT");
      if (
        fact.visibility === "visible" &&
        geo !== undefined &&
        previous !== undefined &&
        previousGeoPoint !== undefined &&
        compareIsoTimestamps(fact.observedAt, previous.updatedAt) > 0
      ) {
        const priorTrack =
          priorTrackRef?.kind === "artifact"
            ? await this.business.getArtifactVersion(
                scope,
                priorTrackRef.id,
                priorTrackRef.revision,
              )
            : undefined;
        if (
          priorTrack !== undefined &&
          (priorTrack.artifactType !== "target.track" ||
            priorTrack.availability !== "available" ||
            priorTrack.content.kind !== "geojson" ||
            priorTrack.content.geometry.type !== "LineString")
        )
          throw new Error("TARGET_TRACK_REF_INVALID");
        const oldCoordinates =
          priorTrack?.availability === "available" &&
          priorTrack.content.kind === "geojson" &&
          priorTrack.content.geometry.type === "LineString"
            ? priorTrack.content.geometry.coordinates
            : undefined;
        const extension =
          priorTrack !== undefined && oldCoordinates !== undefined && oldCoordinates.length < 10_000
            ? priorTrack
            : undefined;
        const coordinates =
          extension !== undefined && oldCoordinates !== undefined
            ? [...oldCoordinates, geo.geometry.coordinates]
            : [previousGeoPoint, geo.geometry.coordinates];
        track = TaskArtifactSchema.parse({
          schemaVersion: "sdar.task-artifact/1.0-rc2",
          artifactId: extension?.artifactId ?? `${artifactId}-track-${previous.revision}`,
          artifactType: "target.track",
          revision: extension === undefined ? 1 : extension.revision + 1,
          semantics: "observed",
          lifecycle: "active",
          identity: scopeBusinessIdentity(scope),
          source: {
            producer: "device",
            sourceRecordRef: fact.sourceTargetId,
            sourceRevision: fact.sourceRevision,
            method: "mqtt_area_recon_targets",
          },
          createdAt: extension?.createdAt ?? previous.updatedAt,
          updatedAt: fact.observedAt,
          relations: [{ relationType: "target", target: ref }],
          availability: "available",
          properties: { targetId: artifactId, sampleCount: coordinates.length },
          content: {
            kind: "geojson",
            crs: "OGC:CRS84",
            geometry: { type: "LineString", coordinates },
          },
        });
        activeRefs[trackKey] = { kind: "artifact", id: track.artifactId, revision: track.revision };
      } else if (!sameObservationTime) {
        activeRefs = Object.fromEntries(
          Object.entries(activeRefs).filter(([key]) => key !== trackKey),
        );
      }
      const trackRef =
        track === undefined
          ? undefined
          : { kind: "artifact" as const, id: track.artifactId, revision: track.revision };
      const context = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        activeRefs,
        artifactRefs: [...current.artifactRefs, ref, ...(trackRef === undefined ? [] : [trackRef])],
        updatedAt:
          compareIsoTimestamps(fact.observedAt, current.updatedAt) > 0
            ? fact.observedAt
            : current.updatedAt,
      });
      const reasonCode =
        previous === undefined
          ? "RECON_TARGET_DISCOVERED"
          : fact.visibility === "lost"
            ? "RECON_TARGET_LOST"
            : previousVisibility === "lost" && fact.visibility === "visible"
              ? "RECON_TARGET_REAPPEARED"
              : "RECON_TARGET_UPDATED";
      const body = TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "ARTIFACT_CHANGED",
        contextRevision: context.contextRevision,
        providerRecordedAt: fact.observedAt,
        payload: {
          change: previous === undefined ? "create" : "update",
          artifactRef: ref,
          ...(previous === undefined ? {} : { previousRevision: previous.revision }),
          reasonCode,
        },
      });
      try {
        const events = [
          { body, description: reasonCode, reasonCode, severityHint: "info" as const },
        ];
        if (track !== undefined && trackRef !== undefined) {
          const trackReasonCode = "RECON_TARGET_TRACK_OBSERVED";
          events.push({
            body: TaskBusinessFeedbackBodySchema.parse({
              schemaVersion: "sdar.task-business-feedback/1.0-rc2",
              kind: "ARTIFACT_CHANGED",
              contextRevision: context.contextRevision,
              providerRecordedAt: fact.observedAt,
              payload: {
                change: track.revision === 1 ? "create" : "update",
                artifactRef: trackRef,
                ...(track.revision === 1 ? {} : { previousRevision: track.revision - 1 }),
                reasonCode: trackReasonCode,
              },
            }),
            description: trackReasonCode,
            reasonCode: trackReasonCode,
            severityHint: "info",
          });
        }
        const committed = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: current.contextRevision,
            context,
            objects: [
              { kind: "artifact", value: artifact },
              ...(track === undefined ? [] : [{ kind: "artifact" as const, value: track }]),
            ],
          },
          events,
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
    throw new Error("TARGET_RETRY_EXHAUSTED");
  }
}
