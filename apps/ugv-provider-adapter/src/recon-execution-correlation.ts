import type { ProviderExecution } from "../../../packages/provider-adapter-kit/src/index.js";
import type { AppliedMqttObservation } from "../../../packages/vehicle-mqtt-ingress/src/index.js";
import { decodeObservationCursorV1 } from "../../../packages/vehicle-provider-core/src/observation-cursor.js";
import { compareIsoTimestamps } from "../../../packages/vehicle-provider-core/src/time.js";

export const RECON_CORRELATIONS = ["STRICT_CORRELATED", "INFERRED_CURRENT_EXECUTION"] as const;
export type ReconCorrelation = (typeof RECON_CORRELATIONS)[number];
type Resolution =
  | { kind: "UNRESOLVED" }
  | { kind: ReconCorrelation; execution: ProviderExecution; missionId: string };
const terminal = new Set(["SUCCEEDED", "BUSINESS_FAILED", "CANCELLED", "TECHNICAL_FAILED"]);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Resolve this packet, never a sticky mission ID inherited from another topic. */
export function resolveReconExecutionCorrelation(input: {
  active: readonly ProviderExecution[];
  providerId: string;
  resourceId: string;
  applied: AppliedMqttObservation | undefined;
  nowMs: number;
  maxAgeMs: number;
  maximumFutureSkewMs?: number;
}): Resolution {
  const unresolved: Resolution = { kind: "UNRESOLVED" };
  const { applied } = input;
  if (!applied || applied.retained) return unresolved;
  const cursor = decodeObservationCursorV1(applied.cursor);
  if (
    cursor?.kind !== "topic" ||
    !["/ugv/area_recon/status", "/ugv/area_recon/targets", "/ugv/area_recon/coverage"].includes(
      cursor.topic,
    ) ||
    cursor.observedAt !== applied.observedAt
  )
    return unresolved;
  const age = input.nowMs - Date.parse(applied.observedAt);
  if (!Number.isFinite(age) || age < -(input.maximumFutureSkewMs ?? 0) || age > input.maxAgeMs)
    return unresolved;
  const source = applied.observation.canonicalPayload;
  if (!record(source)) return unresolved;
  const identities: string[] = [];
  for (const fields of [source, ...(record(source.lock) ? [source.lock] : [])]) {
    const keys = ["mission_id", "missionId", "session_id", "sessionId"];
    // The status normalizer also recognizes top-level id as a mission identity.
    if (fields === source && cursor.topic === "/ugv/area_recon/status") keys.push("id");
    for (const key of keys) {
      if (!Object.hasOwn(fields, key)) continue;
      const raw = fields[key];
      const id = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : raw;
      // Malformed explicit identity is not an anonymous observation.
      if (typeof id !== "string" || id.length === 0 || id.trim() !== id) return unresolved;
      identities.push(id);
    }
  }
  if (new Set(identities).size > 1) return unresolved;
  const explicit = identities[0];
  const candidates = input.active.filter(
    (execution) =>
      execution.providerId === input.providerId &&
      execution.resourceId === input.resourceId &&
      execution.operationName === "vehicle_area_recon" &&
      !terminal.has(execution.state) &&
      (explicit === undefined || execution.downstreamMissionIds.at(-1) === explicit),
  );
  if (candidates.length !== 1) return unresolved;
  const execution = candidates[0];
  if (!execution) return unresolved;
  const missionId = execution.downstreamMissionIds.at(-1);
  if (
    !missionId ||
    execution.state === "ACCEPTED" ||
    compareIsoTimestamps(applied.observedAt, execution.createdAt) < 0 ||
    applied.cursor === execution.observationCursors?.reconnaissance
  )
    return unresolved;
  const baseline = execution.dispatchBaseline;
  if (record(baseline)) {
    if (
      typeof baseline.capturedAt === "string" &&
      compareIsoTimestamps(applied.observedAt, baseline.capturedAt) < 0
    )
      return unresolved;
    if (
      Array.isArray(baseline.observationAuthorities) &&
      baseline.observationAuthorities.some(
        (authority: unknown) => record(authority) && authority.cursor === applied.cursor,
      )
    )
      return unresolved;
  }
  return {
    kind: explicit === undefined ? "INFERRED_CURRENT_EXECUTION" : "STRICT_CORRELATED",
    execution,
    missionId,
  };
}
