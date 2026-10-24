import type { ResultRecord } from "./results.js";
import type { SourceRef } from "./model.js";

export interface InspectionFinding {
  observationKind: "detection" | "track";
  targetType: string;
  sourceTargetId: string;
  frameId: string;
  trackId: string | null;
  sourceRef: string;
  sourceRecordRevision: number;
  observedAt: string | null;
  longitude: number | null;
  latitude: number | null;
  ellipsoidHeightM: number | null;
  rangeSource: string | null;
  confidence: number | null;
  pixel: Record<string, unknown>;
  dataOrigin: "simulated";
}
export interface InspectionSummary {
  schemaVersion: "ugv.zmq-inspection-summary/1";
  targetReportCount: number;
  validEmptyFrameCount: number;
  observationCount: number;
  anomalies: InspectionFinding[];
  sourceTruncated: boolean;
  acquisitionTimeUnknown: boolean;
  coverage: {
    ratio: number | null;
    complete: boolean | null;
    conflict: boolean;
    sourceRef: SourceRef | null;
    declaredAt: string | null;
    footprints: null;
  };
  lastRevision: number;
  missingEvidence: string[];
}
export const emptyInspection = (): InspectionSummary => ({
  schemaVersion: "ugv.zmq-inspection-summary/1",
  targetReportCount: 0,
  validEmptyFrameCount: 0,
  observationCount: 0,
  anomalies: [],
  sourceTruncated: false,
  acquisitionTimeUnknown: false,
  coverage: {
    ratio: null,
    complete: null,
    conflict: false,
    sourceRef: null,
    declaredAt: null,
    footprints: null,
  },
  lastRevision: 0,
  missingEvidence: [],
});
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Fold only validated, task-correlated, immutable result records. Never count physical entities. */
export function foldInspection(summary: InspectionSummary, record: ResultRecord): void {
  if (record.revision <= summary.lastRevision) return;
  summary.lastRevision = record.revision;
  const d = obj(record.content.data),
    key = record.content.key;
  if (record.kind === "coverage") {
    const t = obj(d.task),
      ratio = num(t.coverage_ratio),
      complete = typeof t.coverage_complete === "boolean" ? t.coverage_complete : null;
    const conflict = (ratio === 1 && complete === false) || (complete === true && ratio !== 1);
    summary.coverage = {
      ratio,
      complete,
      conflict: summary.coverage.conflict || conflict,
      sourceRef: record.sourceRef,
      declaredAt:
        typeof record.content.publishedAt === "string" ? record.content.publishedAt : null,
      footprints: null,
    };
    return;
  }
  if (record.kind !== "inspection_frame") return;
  const observed = num(d.observed_at_utc_ms);
  if (observed === null) summary.acquisitionTimeUnknown = true;
  if (key === "targetlist") {
    summary.targetReportCount++;
    if (list(d.targets).length === 0) summary.validEmptyFrameCount++;
    if (d.truncated === true) summary.sourceTruncated = true;
  }
  const findings = list(d.targets);
  // A track is an observation, not a stable identity linked to detection IDs in other frames.
  for (const t of findings) {
    const image = obj(key === "targetlist" ? d.image : t.image),
      position = obj(t.position);
    const finding: InspectionFinding = {
      observationKind: key === "targetlist" ? "detection" : "track",
      targetType: typeof t.category === "string" ? t.category : "tracked_object",
      sourceTargetId: String(key === "targetlist" ? t.target_id : d.target_id),
      frameId: String(image.frame_id),
      trackId: typeof d.track_id === "string" ? d.track_id : null,
      sourceRef: `${record.sourceRef.partitionHash}/${record.sourceRef.sessionId}/${record.sourceRef.ordinal}`,
      sourceRecordRevision: record.revision,
      observedAt: observed === null ? null : new Date(observed).toISOString(),
      longitude: num(position.longitude_deg),
      latitude: num(position.latitude_deg),
      ellipsoidHeightM: num(position.ellipsoid_height_m),
      rangeSource: typeof t.range_source === "string" ? t.range_source : null,
      confidence: num(t.confidence),
      pixel: obj(t.pixel),
      dataOrigin: "simulated",
    };
    summary.observationCount++;
    if (summary.anomalies.length < 256) summary.anomalies.push(finding);
  }
}
export function inspectionReport(
  summary: InspectionSummary,
  pending = false,
): Record<string, unknown> {
  const missingEvidence = new Set([
    "SOURCE_STREAM_COMPLETENESS_UNVERIFIED",
    "SOURCE_PRODUCER_EPOCH_UNATTESTED",
    "COVERAGE_FOOTPRINTS_UNAVAILABLE",
    "TASK_TRAJECTORY_EVIDENCE_UNAVAILABLE",
    ...summary.missingEvidence,
  ]);
  if (!summary.targetReportCount) missingEvidence.add("TASK_TARGET_REPORT_MISSING");
  if (summary.sourceTruncated) missingEvidence.add("SOURCE_TRUNCATED_NOT_RECOVERABLE");
  if (summary.acquisitionTimeUnknown) missingEvidence.add("ACQUISITION_TIME_UNKNOWN");
  if (summary.coverage.complete !== true || summary.coverage.ratio !== 1)
    missingEvidence.add("COVERAGE_INSUFFICIENT_OR_UNVERIFIED");
  if (summary.coverage.conflict) missingEvidence.add("COVERAGE_DECLARATION_CONFLICT");
  if (pending) missingEvidence.add("LOCAL_REPORT_PROJECTION_PENDING");
  return {
    schemaVersion: "ugv.zmq-inspection-result/1",
    outcome: "partial",
    inspectionReport: {
      completion: summary.targetReportCount ? "partial" : "unavailable",
      complete: false,
      sourceStreamComplete: null,
      targetReportCount: summary.targetReportCount,
      validEmptyFrameCount: summary.validEmptyFrameCount,
      absenceConclusion: summary.observationCount
        ? "observations_received"
        : summary.targetReportCount
          ? "no_observations_in_received_frames"
          : "unavailable",
      note: "发现数量为逐帧观测项数；有效空帧不能证明全任务没有发现。",
    },
    anomalies: summary.anomalies,
    observationCount: summary.observationCount,
    uniqueEntityCount: null,
    coverageEvidence: summary.coverage,
    correlationStrength: "native_task_and_receiver_session_producer_epoch_unattested",
    missingEvidence: [...missingEvidence],
    truncated: summary.observationCount > summary.anomalies.length,
    sourceTruncated: summary.sourceTruncated,
    fullReceivedReport: {
      query: "provider.resultPage",
      lastRevision: summary.lastRevision,
      includes: "platform_retained_reports_only",
    },
  };
}
