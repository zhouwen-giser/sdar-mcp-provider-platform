import { z } from "zod";
export const TRAJECTORY_HISTORY_VERSION = "1.0";
export const HISTORY_QUERY_OPERATION = "vehicle_get_trajectory_history";
export const HISTORY_EVIDENCE_OPERATION = "vehicle_get_trajectory_evidence";
export const HISTORY_CHAIN_ALGORITHM = "SMPP_CANONICAL_JSON_SHA256_CHAIN_V1";
export const DecimalSequenceSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n, "POSTGRES_BIGINT_BOUND_REQUIRED");
export const PositiveSequenceSchema = DecimalSequenceSchema.refine(
  (value) => value !== "0",
  "POSITIVE_SEQUENCE_REQUIRED",
);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const utc = z.iso.datetime().refine((value) => value.endsWith("Z"), "UTC_REQUIRED");
export const ReceptionScopeSchema = z
  .object({
    providerId: z.string().min(1).max(256),
    resourceId: z.string().min(1).max(256),
    deviceId: z.string().min(1).max(256),
    deviceIdentityAuthority: z.enum(["GOWM_DEVICE_BINDING", "PROVIDER_RESOURCE_CONFIGURATION"]),
    streamId: z.uuid(),
    sourceSessionKey: z.string().min(1).max(256),
    smppServiceKey: z.string().min(1).max(256).optional(),
    bindingId: z.uuid().optional(),
  })
  .strict();
export const ReceptionTimeSchema = z
  .object({
    utc,
    owner: z.literal("PROVIDER_MQTT_MESSAGE_CALLBACK"),
    clockId: z.string().min(1).max(256),
    resolution: z.literal("MILLISECOND"),
    synchronization: z.literal("UNVERIFIED"),
    accuracyBoundMilliseconds: z.null(),
    processMonotonicNanoseconds: z.string().regex(/^[0-9]+$/),
  })
  .strict();
export const ReportedTimeSchema = z
  .object({
    originalField: z.string().min(1).max(256),
    rawValueJson: z.string().max(4096),
    valueProvenance: z.literal("DECODED_JSON_VALUE_NOT_ORIGINAL_WIRE_LEXEME"),
    unit: z.enum([
      "ISO8601",
      "EPOCH_MICROSECONDS",
      "MICROSECONDS_UNSPECIFIED_EPOCH",
      "ROS_SECONDS_NANOSECONDS",
      "UNKNOWN",
    ]),
    timeBase: z.enum(["REPORTED_UNIX_EPOCH", "UNKNOWN"]),
    reportedClockOwner: z.literal("MESSAGE_PRODUCER_UNVERIFIED"),
    normalizedUtc: utc.nullable(),
    conversion: z.string().max(512).nullable(),
    calibration: z.null(),
    quality: z.enum([
      "REPORTED_UNVERIFIED",
      "UNKNOWN_TIMEBASE",
      "INVALID",
      "REPORTED_CLOCK_REGRESSION",
    ]),
  })
  .strict();
export const ReceptionReceiptSchema = z
  .object({
    schemaVersion: z.literal("ugv.trajectory-reception/1.0"),
    receptionId: z.uuid(),
    sessionId: z.uuid(),
    sourceTopic: z.string().min(1).max(256),
    originalMessageSha256: Sha256Schema,
    originalMessageBytes: z.number().int().nonnegative(),
    originalMessageReference: z.string().min(1).max(512),
    providerReceivedAt: ReceptionTimeSchema,
    reportedTime: ReportedTimeSchema.nullable(),
    deviceAcquisitionTime: z.null(),
    deviceClockAttribution: z.literal("NOT_ATTESTED_BY_PRODUCER_CONTRACT"),
    sourceReportedSequence: z.string().max(256).nullable(),
    sourceProducerEpoch: z.null(),
    transport: z
      .object({
        qos: z.number().int().min(0).max(2),
        packetId: z.number().int().min(1).max(65535).nullable(),
        duplicateDeliveryHint: z.boolean(),
        retainedDelivery: z.boolean(),
      })
      .strict(),
    disposition: z.enum(["POSITION_OBSERVATION", "NO_POSITION", "REJECTED"]),
    reasonCode: z.string().min(1).max(128),
    position: z
      .object({
        longitude: z.number().min(-180).max(180),
        latitude: z.number().min(-90).max(90),
        altitude: z.number().optional(),
        crs: z.literal("OGC:CRS84"),
        derivation: z.literal("VERSIONED_PROVIDER_NORMALIZER"),
      })
      .strict()
      .nullable(),
    reportedMission: z
      .object({
        missionId: z.string().min(1).max(256),
        provenance: z.literal("SAME_ORIGINAL_MESSAGE"),
        producerEpoch: z.null(),
        executionOwnership: z.literal("NOT_ATTESTED"),
      })
      .strict()
      .nullable(),
    evidenceClass: z.enum(["SIMULATED", "UNQUALIFIED_SOURCE"]),
    diagnostics: z.array(z.string().min(1).max(128)).max(32),
  })
  .strict();
export const ReceptionEntrySchema = z
  .object({
    sequence: PositiveSequenceSchema,
    previousHash: Sha256Schema,
    hash: Sha256Schema,
    receipt: ReceptionReceiptSchema,
    recordedAt: utc,
    recordingClockOwner: z.literal("POSTGRESQL_RECORD_INSERTION_CLOCK"),
    recordingResolution: z.literal("MICROSECOND"),
    exactTransactionCommittedAt: z.null(),
  })
  .strict();
const completeness = z
  .object({
    status: z.enum(["complete", "incomplete", "unknown"]),
    reasons: z.array(z.string().min(1).max(128)).max(32),
  })
  .strict();
export const HistoryManifestSchema = z
  .object({
    schemaVersion: z.literal("ugv.trajectory-history-manifest/1.0"),
    scope: ReceptionScopeSchema,
    snapshotId: z.uuid(),
    capturedFromSequence: PositiveSequenceSchema,
    capturedFromRecordingTime: utc,
    activationClockOwner: z.literal("POSTGRESQL_STREAM_CREATION_CLOCK"),
    guaranteedSinceHistoryVersion: z.literal(TRAJECTORY_HISTORY_VERSION),
    fromSequence: PositiveSequenceSchema,
    throughSequence: DecimalSequenceSchema,
    highWatermark: DecimalSequenceSchema,
    retainedEntryCount: DecimalSequenceSchema,
    expectedOrdinalCount: DecimalSequenceSchema,
    previousHash: Sha256Schema.nullable(),
    terminalHash: Sha256Schema.nullable(),
    chainAlgorithm: z.literal(HISTORY_CHAIN_ALGORITHM),
    ordering: z.literal("DURABLE_PROVIDER_RECEIPT_SEQUENCE"),
    deduplication: z.literal("RECEPTIONS_NOT_COLLAPSED_INTO_DEVICE_SAMPLES"),
    retainedHistory: completeness,
    providerCaptureCoverage: completeness,
    deviceGenerationHistory: z
      .object({
        status: z.enum(["incomplete", "unknown"]),
        reasons: z.array(z.string().min(1).max(128)).min(1).max(32),
      })
      .strict(),
    legacyHistory: z.literal("NO_RETROACTIVE_RECEPTION_TIME_OR_DEVICE_COMPLETENESS_CLAIM"),
    prunedThroughSequence: DecimalSequenceSchema,
    recovery: z
      .object({
        uncleanSessionCount: z.number().int().nonnegative(),
        disconnectCount: z.number().int().nonnegative(),
        captureFailureCount: z.number().int().nonnegative(),
      })
      .strict(),
    evidenceClass: z.enum(["SIMULATED", "UNQUALIFIED_SOURCE"]),
  })
  .strict()
  .superRefine((value, context) => {
    const start = BigInt(value.fromSequence),
      end = BigInt(value.throughSequence);
    const expected = end < start ? 0n : end - start + 1n;
    if (BigInt(value.expectedOrdinalCount) !== expected || end > BigInt(value.highWatermark))
      context.addIssue({ code: "custom", message: "MANIFEST_BOUNDARIES_INVALID" });
    if (
      value.retainedHistory.status === "complete" &&
      (value.previousHash === null ||
        value.terminalHash === null ||
        value.retainedEntryCount !== value.expectedOrdinalCount ||
        (expected > 0n && start <= BigInt(value.prunedThroughSequence)))
    )
      context.addIssue({ code: "custom", message: "MANIFEST_COMPLETE_CLAIM_INVALID" });
  });
export const SignedHistoryManifestSchema = z
  .object({
    manifest: HistoryManifestSchema,
    signature: z
      .object({
        algorithm: z.literal("Ed25519"),
        keyId: Sha256Schema,
        value: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
      })
      .strict(),
  })
  .strict();
export const HistoryQuerySchema = z
  .object({
    resourceId: z.string().min(1).max(256),
    historyVersion: z.literal(TRAJECTORY_HISTORY_VERSION),
    fromSequence: PositiveSequenceSchema.optional(),
    throughSequence: DecimalSequenceSchema.optional(),
    pageCursor: z.string().min(1).max(16384).optional(),
    limit: z.number().int().min(1).max(256).optional(),
    maxPageBytes: z.number().int().min(8192).max(1048576).optional(),
  })
  .strict();
export const HistoryPageSchema = z
  .object({
    schemaVersion: z.literal("ugv.trajectory-history-page/1.0"),
    snapshot: SignedHistoryManifestSchema,
    entries: z.array(ReceptionEntrySchema).max(256),
    nextCursor: z.string().max(16384).nullable(),
    rangeReadFinished: z.boolean(),
  })
  .strict();
export function trajectoryHistorySchemas() {
  // The frozen registry recognizes date-time but has no UUID format plugin.
  // Zod emits the exact UUID regex too; use that portable validation unchanged.
  const portable = (schema) =>
    z.toJSONSchema(schema, {
      override: ({ jsonSchema }) => {
        if (jsonSchema.format === "uuid" && typeof jsonSchema.pattern === "string")
          delete jsonSchema.format;
      },
    });
  return {
    reception: portable(ReceptionReceiptSchema),
    entry: portable(ReceptionEntrySchema),
    query: portable(HistoryQuerySchema),
    page: portable(HistoryPageSchema),
    evidenceQuery: portable(TrajectoryEvidenceQuerySchema),
    evidence: portable(SignedProjectionEvidenceSchema),
  };
}
export const TrajectoryEvidenceQuerySchema = z
  .object({
    resourceId: z.string().min(1).max(256),
    historyVersion: z.literal(TRAJECTORY_HISTORY_VERSION),
    taskId: z.string().min(1).max(256),
    executionId: z.string().min(1).max(512),
    artifactId: z.string().min(1).max(256),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const coordinates = z.array(z.number()).min(2).max(3);
export const ProjectionEvidenceSchema = z
  .object({
    schemaVersion: z.literal("ugv.trajectory-artifact-evidence/1.0"),
    identity: z
      .object({
        taskId: z.string(),
        executionId: z.string(),
        providerId: z.string(),
        resourceId: z.string(),
        operationName: z.literal("vehicle_navigate"),
        correlationId: z.string().optional(),
        simulationId: z.string().optional(),
      })
      .strict(),
    artifactId: z.string(),
    revision: z.number().int().positive(),
    artifactGeometrySha256: Sha256Schema,
    projectionPolicy: z.literal("SAMPLED_GEOMETRY_NOT_FULL_RECEPTION_HISTORY"),
    sampleEveryMilliseconds: z.number().int().nonnegative().nullable(),
    missionBinding: z
      .object({
        missionId: z.string().nullable(),
        authority: z.literal("PROVIDER_CURRENT_MISSION_AND_UNIQUE_ACTIVE_EXECUTION"),
        deviceExecutionOwnership: z.literal("NOT_ATTESTED"),
      })
      .strict(),
    points: z
      .array(
        z
          .object({
            coordinateIndex: z.number().int().nonnegative().max(255),
            coordinate: coordinates,
            reception: z
              .object({
                scope: ReceptionScopeSchema,
                receptionId: z.uuid(),
                sequence: PositiveSequenceSchema,
                entryHash: Sha256Schema,
                originalMessageSha256: Sha256Schema,
                providerReceivedAt: ReceptionTimeSchema,
                evidenceClass: z.enum(["SIMULATED", "UNQUALIFIED_SOURCE"]),
              })
              .strict()
              .nullable(),
            receptionTimeQuality: z.enum([
              "ENTRANCE_RECEIPT_LINKED",
              "UNKNOWN_LEGACY_OR_UNJOURNALED",
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(256),
    deviceGenerationHistory: z.literal("UNKNOWN_PRODUCER_BOUNDARIES_NOT_ATTESTED"),
  })
  .strict();
export const SignedProjectionEvidenceSchema = z
  .object({
    evidence: ProjectionEvidenceSchema,
    signature: SignedHistoryManifestSchema.shape.signature,
  })
  .strict();
