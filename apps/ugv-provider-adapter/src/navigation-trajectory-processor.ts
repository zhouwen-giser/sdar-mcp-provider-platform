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
import { TaskArtifactSchema } from "../../../packages/vehicle-provider-core/src/task-business-artifact.js";
import {
  compareIsoTimestamps,
  millisecondsBetweenIsoTimestamps,
} from "../../../packages/vehicle-provider-core/src/time.js";

const positionSchema = z
  .object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
    altitude: z.number().optional(),
  })
  .strict();
const factSchema = z
  .object({
    schemaVersion: z.literal("ugv.navigation-position-fact/1"),
    missionId: z.string().min(1).max(256),
    sourceCursor: z.string().min(1).max(4096),
    sourceTopic: z.string().min(1).max(256),
    observedAt: z.iso.datetime({ offset: true }),
    position: positionSchema,
  })
  .strict();
export type NavigationPositionFact = z.infer<typeof factSchema>;

const lastSchema = z
  .object({
    missionId: z.string(),
    cursorHash: z.string(),
    observedAt: z.iso.datetime({ offset: true }),
    position: positionSchema,
    segmentId: z.string(),
  })
  .strict();
const terminal = new Set(["SUCCEEDED", "BUSINESS_FAILED", "CANCELLED", "TECHNICAL_FAILED"]);
const MAX_SEGMENT_SAMPLES = 256;
const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Projects only a caller-qualified, mission-bound and accepted geodetic observation. */
export class NavigationTrajectoryProcessor {
  constructor(
    readonly business: Pick<
      TaskBusinessStore,
      "getContext" | "getArtifactLatest" | "commitBusinessChangeSet"
    >,
    readonly notifyCommitted: (event: AdapterBusinessEvent) => void,
    readonly maxGapMs: number,
    readonly sampleEveryMs = 0,
  ) {
    if (!Number.isFinite(maxGapMs) || maxGapMs <= 0)
      throw new Error("TRAJECTORY_GAP_THRESHOLD_INVALID");
    if (!Number.isSafeInteger(sampleEveryMs) || sampleEveryMs < 0)
      throw new Error("TRAJECTORY_SAMPLE_INTERVAL_INVALID");
  }

  async apply(execution: ProviderExecution, input: unknown): Promise<"committed" | "duplicate"> {
    const fact = factSchema.parse(input);
    if (
      execution.operationName !== "vehicle_navigate" ||
      execution.taskBusinessContextExpected !== true ||
      execution.downstreamMissionIds.at(-1) !== fact.missionId ||
      execution.state === "ACCEPTED" ||
      terminal.has(execution.state) ||
      compareIsoTimestamps(fact.observedAt, execution.createdAt) < 0
    )
      throw new Error("TRAJECTORY_EXECUTION_BINDING_INVALID");
    const scope = BoundExecutionScope.fromExecution(execution);
    const cursorHash = hash(fact.sourceCursor);
    const position =
      fact.position.altitude === undefined
        ? [fact.position.longitude, fact.position.latitude]
        : [fact.position.longitude, fact.position.latitude, fact.position.altitude];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.business.getContext(scope);
      if (!current || current.summary.status === "finalized")
        throw new Error("TRAJECTORY_CONTEXT_UNAVAILABLE");
      const lastParsed = lastSchema.safeParse(current.summary.properties?.trajectoryLast);
      const last = lastParsed.success ? lastParsed.data : undefined;
      if (last?.missionId === fact.missionId) {
        if (last.cursorHash === cursorHash) {
          if (
            !isDeepStrictEqual(last.position, fact.position) ||
            last.observedAt !== fact.observedAt
          )
            throw new Error("TRAJECTORY_SOURCE_CURSOR_CONFLICT");
          return "duplicate";
        }
        const timeOrder = compareIsoTimestamps(fact.observedAt, last.observedAt);
        if (timeOrder < 0) return "duplicate";
        if (timeOrder === 0) {
          if (!isDeepStrictEqual(last.position, fact.position))
            throw new Error("TRAJECTORY_SAME_TIME_POSITION_CONFLICT");
          return "duplicate";
        }
        // The persisted last sample enforces the declared projection interval
        // across restarts; raw MQTT and physical confirmation remain full-rate.
        if (millisecondsBetweenIsoTimestamps(fact.observedAt, last.observedAt) < this.sampleEveryMs)
          return "duplicate";
      }
      const oldRef = current.activeRefs.trajectory;
      if (oldRef !== undefined && oldRef.kind !== "artifact")
        throw new Error("TRAJECTORY_ACTIVE_REF_INVALID");
      const old =
        oldRef === undefined ? undefined : await this.business.getArtifactLatest(scope, oldRef.id);
      if (oldRef !== undefined) {
        if (old === undefined) throw new Error("TRAJECTORY_ACTIVE_REF_INVALID");
        if (
          old.revision !== oldRef.revision ||
          old.artifactType !== "navigation.trajectory" ||
          old.availability !== "available" ||
          old.content.kind !== "geojson" ||
          !["Point", "LineString"].includes(old.content.geometry.type)
        )
          throw new Error("TRAJECTORY_ACTIVE_REF_INVALID");
      }
      const oldPosition =
        old?.availability === "available" && old.content.kind === "geojson"
          ? old.content.geometry.type === "Point"
            ? old.content.geometry.coordinates
            : old.content.geometry.type === "LineString"
              ? old.content.geometry.coordinates.at(-1)
              : undefined
          : undefined;
      const samePosition = oldPosition !== undefined && isDeepStrictEqual(oldPosition, position);
      const gap =
        last?.missionId !== fact.missionId ||
        millisecondsBetweenIsoTimestamps(fact.observedAt, last.observedAt) > this.maxGapMs;
      const split =
        old === undefined ||
        gap ||
        (!samePosition &&
          old.availability === "available" &&
          old.content.kind === "geojson" &&
          old.content.geometry.type === "LineString" &&
          old.content.geometry.coordinates.length >= MAX_SEGMENT_SAMPLES);
      const segmentId = split
        ? `trajectory-${hash([execution.externalExecutionId, fact.missionId, cursorHash]).slice(0, 32)}`
        : old.artifactId;
      if (!segmentId) throw new Error("TRAJECTORY_SEGMENT_ID_MISSING");
      const lastObservation = {
        missionId: fact.missionId,
        cursorHash,
        observedAt: fact.observedAt,
        position: fact.position,
        segmentId,
      };
      // Repeated stationary samples advance the durable observation clock but
      // do not produce identical geometry revisions or public Artifact events.
      if (!split && samePosition) {
        const context = TaskBusinessContextSchema.parse({
          ...current,
          contextRevision: current.contextRevision + 1,
          summary: {
            ...current.summary,
            properties: { ...current.summary.properties, trajectoryLast: lastObservation },
          },
          updatedAt: later(current.updatedAt, fact.observedAt),
        });
        try {
          await this.business.commitBusinessChangeSet(
            { scope, expectedContextRevision: current.contextRevision, context, objects: [] },
            [],
          );
          return "committed";
        } catch (error) {
          if (!revisionConflict(error, attempt)) throw error;
          continue;
        }
      }
      const oldCoordinates =
        old?.availability === "available" && old.content.kind === "geojson"
          ? old.content.geometry.type === "Point"
            ? [old.content.geometry.coordinates]
            : old.content.geometry.type === "LineString"
              ? old.content.geometry.coordinates
              : []
          : [];
      const coordinates = split ? [position] : [...oldCoordinates, position];
      const artifact = TaskArtifactSchema.parse({
        schemaVersion: "sdar.task-artifact/1.0-rc2",
        artifactId: segmentId,
        artifactType: "navigation.trajectory",
        revision: split ? 1 : old.revision + 1,
        semantics: "observed",
        lifecycle: "active",
        identity: scopeBusinessIdentity(scope),
        source: {
          producer: "device",
          sourceRecordRef: fact.sourceTopic,
          sourceRevision: cursorHash,
          method: "mqtt_navigation_position",
        },
        createdAt: split ? fact.observedAt : old.createdAt,
        updatedAt: fact.observedAt,
        availability: "available",
        properties: { sampleCount: coordinates.length },
        relations: [
          {
            relationType: "observed_for_mission",
            target: { externalType: "ugv.mission", externalId: fact.missionId },
          },
        ],
        content: {
          kind: "geojson",
          crs: "OGC:CRS84",
          geometry:
            coordinates.length === 1
              ? { type: "Point", coordinates: position }
              : { type: "LineString", coordinates },
        },
      });
      const ref = {
        kind: "artifact" as const,
        id: artifact.artifactId,
        revision: artifact.revision,
      };
      const context = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        activeRefs: { ...current.activeRefs, trajectory: ref },
        artifactRefs: [
          ...current.artifactRefs.filter((candidate) => split || candidate.id !== oldRef?.id),
          ref,
        ],
        summary: {
          ...current.summary,
          properties: { ...current.summary.properties, trajectoryLast: lastObservation },
        },
        updatedAt: later(current.updatedAt, fact.observedAt),
      });
      const reasonCode = split
        ? "NAVIGATION_TRAJECTORY_SEGMENT_STARTED"
        : "NAVIGATION_TRAJECTORY_UPDATED";
      const body = TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "ARTIFACT_CHANGED",
        contextRevision: context.contextRevision,
        providerRecordedAt: fact.observedAt,
        payload: {
          change: split ? "create" : "update",
          artifactRef: ref,
          ...(split ? {} : { previousRevision: old.revision }),
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
        if (!revisionConflict(error, attempt)) throw error;
      }
    }
    throw new Error("TRAJECTORY_RETRY_EXHAUSTED");
  }
}

function later(a: string, b: string): string {
  return compareIsoTimestamps(a, b) >= 0 ? a : b;
}

function revisionConflict(error: unknown, attempt: number): boolean {
  return (
    error instanceof Error && error.message === "BUSINESS_CONTEXT_REVISION_CONFLICT" && attempt < 2
  );
}
