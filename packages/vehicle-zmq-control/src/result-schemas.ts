import { z } from "zod";
import { ResultIdentity } from "./results.js";
const digest = z.string().regex(/^[a-f0-9]{64}$/),
  missing = z.array(z.string()).max(256);
const source = z
  .object({
    partitionHash: digest,
    sessionId: z.uuid(),
    ordinal: z.string().regex(/^[0-9]+$/),
    entryHash: digest,
  })
  .strict();
const record = z.record(z.string(), z.unknown()),
  occupancy = z.enum(["held", "released"]);
const finding = z
  .object({
    observationKind: z.enum(["detection", "track"]),
    targetType: z.string(),
    sourceTargetId: z.string(),
    frameId: z.string(),
    trackId: z.string().nullable(),
    sourceRef: z.string(),
    sourceRecordRevision: z.number().int().positive(),
    observedAt: z.iso.datetime().nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    latitude: z.number().min(-90).max(90).nullable(),
    ellipsoidHeightM: z.number().nullable(),
    rangeSource: z.string().nullable(),
    confidence: z.number().nullable(),
    pixel: record,
    dataOrigin: z.literal("simulated"),
  })
  .strict();
const inspection = z
  .object({
    schemaVersion: z.literal("ugv.zmq-inspection-result/1"),
    outcome: z.literal("partial"),
    inspectionReport: z
      .object({
        completion: z.enum(["partial", "unavailable"]),
        complete: z.literal(false),
        sourceStreamComplete: z.null(),
        targetReportCount: z.number().int().nonnegative(),
        validEmptyFrameCount: z.number().int().nonnegative(),
        absenceConclusion: z.enum([
          "observations_received",
          "no_observations_in_received_frames",
          "unavailable",
        ]),
        note: z.string(),
      })
      .strict(),
    anomalies: z.array(finding).max(256),
    observationCount: z.number().int().nonnegative(),
    uniqueEntityCount: z.null(),
    coverageEvidence: z
      .object({
        ratio: z.number().min(0).max(1).nullable(),
        complete: z.boolean().nullable(),
        conflict: z.boolean(),
        sourceRef: source.nullable(),
        declaredAt: z.iso.datetime().nullable(),
        footprints: z.null(),
      })
      .strict(),
    correlationStrength: z.literal("native_task_and_receiver_session_producer_epoch_unattested"),
    missingEvidence: missing,
    truncated: z.boolean(),
    sourceTruncated: z.boolean(),
    fullReceivedReport: z
      .object({
        query: z.string(),
        lastRevision: z.number().int().nonnegative(),
        includes: z.literal("platform_retained_reports_only"),
      })
      .strict(),
  })
  .loose();
const resultRecord = z
  .object({
    schemaVersion: z.literal("ugv.zmq-result-record/1"),
    identity: ResultIdentity,
    kind: z.enum(["inspection_frame", "coverage", "effect"]),
    sourceRef: source,
    receivedAt: z.iso.datetime(),
    content: record,
    revision: z.number().int().positive(),
    contentHash: digest,
  })
  .strict();
const page = z
  .object({
    schemaVersion: z.literal("ugv.zmq-result-page/1"),
    identity: ResultIdentity,
    records: z.array(resultRecord).max(8),
    nextRevision: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    historySource: z.literal("platform_retained_only"),
  })
  .strict();
const control = z
  .object({
    schemaVersion: z.literal("ugv.zmq-control-result/1"),
    qualification: z.literal("isolated_simulator_only"),
    runtimeAdmission: z.enum(["not_published", "isolated_runtime"]),
    nativeTaskId: z.string().nullable(),
    nativeOutcome: z.string().nullable(),
    nativeReason: z.string().nullable(),
    stopConfirmed: z.boolean(),
    occupancy,
    missingEvidence: missing,
    sourceRefs: z.array(source),
  })
  .strict();
const effect = z
  .object({
    schemaVersion: z.literal("ugv.zmq-effect-result/1"),
    qualification: z.literal("isolated_simulator_only"),
    runtimeAdmission: z.enum(["not_published", "isolated_runtime"]),
    requestAccepted: z.boolean(),
    nativeTaskId: z.string().nullable(),
    executionState: z.string(),
    executionFinished: z.boolean().nullable(),
    effect: z.enum(["unknown", "hit", "miss", "destroyed"]),
    outcome: z.string(),
    missingEvidence: missing,
    sourceRefs: z.array(source),
    supplementalResultRevision: z.number().int().nonnegative(),
    resultQuery: z.literal("simulation_get_effect_result"),
    historySource: z.literal("platform_retained_only"),
  })
  .strict();
export function nativeOutputSchema(name: string): Record<string, unknown> {
  const schema =
    name === "vehicle_zmq_inspect_area"
      ? inspection
      : name === "vehicle_get_inspection_result"
        ? inspection.extend({ identity: ResultIdentity, page })
        : name === "simulation_apply_effect"
          ? effect
          : name === "simulation_get_effect_result"
            ? z
                .object({
                  schemaVersion: z.literal("ugv.zmq-effect-query/1"),
                  identity: ResultIdentity,
                  originalTask: z
                    .object({
                      state: z.string(),
                      reasonCode: z.string(),
                      terminalAt: z.iso.datetime().nullable(),
                      result: record.nullable(),
                    })
                    .strict(),
                  latestRevision: z.number().int().nonnegative(),
                  latest: record.nullable(),
                  occupancy,
                  executionFinished: z.boolean().nullable(),
                  missingEvidence: missing,
                  page,
                })
                .strict()
            : control;
  const { $schema, ...json } = z.toJSONSchema(schema);
  void $schema;
  return json;
}
