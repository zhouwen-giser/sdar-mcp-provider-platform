import type {
  ProviderExecution,
  TaskBusinessStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import { createHash } from "node:crypto";
import { BoundExecutionScope } from "../../../packages/provider-adapter-kit/src/index.js";
import type { TaskArtifact } from "../../../packages/vehicle-provider-core/src/task-business-artifact.js";
import {
  INSPECTION_MAX_FINDINGS,
  InspectionReportSchema,
  inspectionPointInArea,
  parseInspectionInput,
} from "../../../packages/vehicle-provider-core/src/inspection.js";

type Finding = Record<string, string | number | boolean | null>;
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const scalar = (v: unknown): string | number | boolean | null =>
  typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))
    ? v
    : null;

/** Reads only the immutable objects in this execution's already-bound business scope. */
export async function buildInspectionResult(
  execution: ProviderExecution,
  business?: TaskBusinessStore,
): Promise<Record<string, unknown>> {
  const state = execution.inspectionEvidence;
  const missing = new Set(state?.missingEvidence ?? []);
  const scope = BoundExecutionScope.fromExecution(execution);
  const context =
    business && execution.taskBusinessContextExpected
      ? await business.getContext(scope)
      : undefined;
  const missionId = execution.downstreamMissionIds.at(-1);
  const input = parseInspectionInput(execution.arguments);
  const latest = new Map<string, { kind: "artifact"; value: TaskArtifact }>();
  // Read immutable scoped objects separately; a report larger than one transport page stays readable.
  for (const id of new Set(context?.artifactRefs.map((ref) => ref.id) ?? [])) {
    const artifact = await business?.getArtifactLatest(scope, id);
    if (!artifact) continue;
    const item = { kind: "artifact" as const, value: artifact };
    const properties: Record<string, unknown> = record(item.value.properties)
      ? item.value.properties
      : {};
    if (
      item.value.artifactType !== "target.object" ||
      item.value.source.method !== "mqtt_area_recon_targets" ||
      item.value.identity.executionId !== execution.externalExecutionId ||
      item.value.identity.resourceId !== execution.resourceId ||
      item.value.identity.operationName !== execution.operationName ||
      properties.observationSessionId !== missionId
    )
      continue;
    const old = latest.get(item.value.artifactId);
    if (!old || old.value.revision < item.value.revision) latest.set(item.value.artifactId, item);
  }
  const findings: Finding[] = [];
  const refs: { kind: "artifact"; id: string; revision: number }[] = [];
  for (const item of [...latest.values()].sort((a, b) =>
    a.value.artifactId.localeCompare(b.value.artifactId),
  )) {
    const artifact = item.value;
    const properties: Record<string, unknown> = record(artifact.properties)
      ? artifact.properties
      : {};
    const geometry =
      artifact.availability === "available" &&
      artifact.content.kind === "geojson" &&
      artifact.content.geometry.type === "Point"
        ? artifact.content.geometry.coordinates
        : undefined;
    const x = geometry?.[0] ?? null,
      y = geometry?.[1] ?? null;
    const spatialRelation =
      x === null || y === null
        ? "unknown"
        : inspectionPointInArea(input, { x, y })
          ? "inside"
          : "outside";
    // Outside observations remain readable in Context; they are not findings inside the inspected region.
    if (spatialRelation === "outside") continue;
    findings.push({
      findingId: artifact.artifactId,
      kind: "target_observed",
      targetId: artifact.source.sourceRecordRef ?? null,
      targetType: scalar(properties.targetType),
      visibility: scalar(properties.visibility),
      confidence: scalar(properties.confidence),
      observedAt:
        typeof properties.lastSeenAt === "string" ? properties.lastSeenAt : artifact.updatedAt,
      lastReportObservedAt: artifact.updatedAt,
      sourceRecordRef: artifact.source.sourceRecordRef ?? null,
      sourceRevision: artifact.source.sourceRevision ?? null,
      artifactId: artifact.artifactId,
      artifactRevision: artifact.revision,
      correlationStrength: state?.targetReport?.correlation ?? "UNKNOWN",
      spatialRelation,
      x,
      y,
      frame: x === null ? null : "EPSG:4326",
    });
    refs.push({ kind: "artifact", id: artifact.artifactId, revision: artifact.revision });
  }
  for (const exception of state?.exceptions ?? []) {
    const knownPosition = exception.longitude !== undefined && exception.latitude !== undefined;
    if (
      knownPosition &&
      !inspectionPointInArea(input, { x: exception.longitude ?? 0, y: exception.latitude ?? 0 })
    )
      continue;
    findings.push({
      findingId: eventReference(exception.cursor),
      kind: "recon_exception",
      exceptionKind: exception.kind,
      observedAt: exception.observedAt,
      sourceRecordRef: eventReference(exception.cursor),
      sourceRevision: exception.sourceVersion ?? eventReference(exception.cursor),
      targetId: exception.targetId ?? null,
      targetType: exception.targetType ?? null,
      x: exception.longitude ?? null,
      y: exception.latitude ?? null,
      frame: exception.longitude === undefined ? null : "EPSG:4326",
      correlationStrength: exception.correlation,
      errorCode: exception.errorCode,
      reason: exception.reason,
      spatialRelation: knownPosition ? "inside" : "unknown",
    });
  }
  const target = state?.targetReport;
  if (!target || target.missionId !== missionId) missing.add("INSPECTION_TARGET_REPORT_MISSING");
  else if (!target.complete) missing.add("INSPECTION_TARGET_SOURCE_INCOMPLETE");
  if (!context) missing.add("INSPECTION_BUSINESS_CONTEXT_MISSING");
  const areaChanged = context?.activeRefs.reconEffectiveArea !== undefined;
  if (areaChanged) missing.add("INSPECTION_EFFECTIVE_AREA_CHANGED");
  const observedCoverage = state?.coverageReport;
  const coverage =
    !areaChanged && observedCoverage && observedCoverage.missionId === missionId
      ? observedCoverage.coverage
      : null;
  const full =
    record(coverage) &&
    coverage.incomplete !== true &&
    (coverage.coveragePercent === 100 ||
      (typeof coverage.totalCount === "number" &&
        coverage.totalCount > 0 &&
        coverage.coveredCount === coverage.totalCount));
  const coverageState = full
    ? "full"
    : record(coverage)
      ? coverage.coveragePercent === 0
        ? "none"
        : "partial"
      : "unknown";
  if (!full) missing.add("INSPECTION_COVERAGE_INCOMPLETE");
  // Leave transport headroom for report metadata, coverage and MCP result wrapping.
  const inline: Finding[] = [];
  // Frozen business-error classification has a 64 KiB evidence limit.
  // Retained business objects remain readable when failed reports are trimmed.
  const failedReport = execution.state !== "SUCCEEDED";
  const findingsByteLimit = failedReport ? 16 * 1024 : 160 * 1024;
  let inlineBytes = 0;
  for (const finding of findings) {
    const bytes = Buffer.byteLength(JSON.stringify(finding), "utf8");
    if (inline.length >= INSPECTION_MAX_FINDINGS || inlineBytes + bytes > findingsByteLimit) break;
    inline.push(finding);
    inlineBytes += bytes;
  }
  const referenceLimit = failedReport ? 64 : INSPECTION_MAX_FINDINGS;
  const truncated = findings.length > inline.length || refs.length > referenceLimit;
  if (truncated) missing.add("INSPECTION_INLINE_REPORT_TRUNCATED");
  if (execution.state !== "SUCCEEDED") missing.add("INSPECTION_SCAN_NOT_COMPLETED");
  const missingEvidence = [...missing].sort();
  const report = InspectionReportSchema.parse({
    version: "1.0",
    completion: missingEvidence.length === 0 ? "complete" : target ? "partial" : "unavailable",
    targetReportObservedAt: target?.observedAt ?? null,
    targetReportComplete: target?.complete === true,
    coverageState,
    findingCount: findings.length,
    truncated,
    artifactRefs: refs.slice(0, referenceLimit),
  });
  const status = execution.result?.status;
  return {
    resourceId: execution.resourceId,
    status:
      status === "cancelled"
        ? "cancelled"
        : status === "timeout"
          ? "timeout"
          : execution.state === "SUCCEEDED"
            ? "completed"
            : "failed",
    observedAt:
      typeof execution.result?.observedAt === "string"
        ? execution.result.observedAt
        : execution.updatedAt,
    anomalies: inline,
    inspectionReport: report,
    coverage,
    correlationStrength: target?.correlation ?? state?.coverageReport?.correlation ?? "UNKNOWN",
    missingEvidence,
  };
}

function eventReference(cursor: string): string {
  return "inspection-event:" + createHash("sha256").update(cursor).digest("hex");
}
