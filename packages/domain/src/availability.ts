export type AvailabilityState = "available" | "restricted" | "disabled" | "unknown";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ReservationMode = "none" | "best_effort" | "guaranteed";

export interface AvailabilityCheck {
  requestId: string;
  operationName: string;
  arguments:
    | { state: "complete"; value: Record<string, unknown> }
    | {
        state: "partial";
        knownValue: Record<string, unknown>;
        unresolvedPaths: string[];
      };
  timing?: {
    start?: {
      mode: "immediate" | "scheduled";
      scheduledAt?: string;
      startToleranceMs?: number;
    };
    maxElapsedMs?: number | null;
  };
}

export interface AvailabilityResultValue {
  requestId: string;
  operationName: string;
  availability: AvailabilityState;
  riskLevel?: RiskLevel;
  reasonCode?: string;
  description?: string;
  validUntil?: string;
  earliestStartTime?: string;
  nextAvailableWindows?: { startTime: string; endTime: string }[];
  estimatedDelayMs?: number;
  reservationMode: ReservationMode;
  reservationRef?: string;
  possibleEffects?: string[];
}

export interface AvailabilityResponseValue {
  resultType: "complete";
  profileVersion: "1.0";
  results: AvailabilityResultValue[];
}

export function validateAvailabilityResponse(
  checkedAt: Date,
  requested: AvailabilityCheck[],
  results: AvailabilityResultValue[],
): AvailabilityResponseValue {
  if (results.length !== requested.length) throw new Error("AVAILABILITY_RESULT_COUNT_MISMATCH");
  const requestedById = new Map(requested.map((check) => [check.requestId, check]));
  const seen = new Set<string>();
  for (const result of results) {
    const reservationMode: unknown = result.reservationMode;
    if (
      typeof reservationMode !== "string" ||
      !["none", "best_effort", "guaranteed"].includes(reservationMode)
    ) {
      throw new Error("AVAILABILITY_RESERVATION_MODE_MISSING");
    }
    if (
      !(["available", "restricted", "disabled", "unknown"] as string[]).includes(
        result.availability,
      )
    ) {
      throw new Error("AVAILABILITY_INVALID_STATE");
    }
    const request = requestedById.get(result.requestId);
    if (request?.operationName !== result.operationName || seen.has(result.requestId)) {
      throw new Error("AVAILABILITY_RESULT_IDENTITY_MISMATCH");
    }
    seen.add(result.requestId);
    if (result.validUntil !== undefined) {
      const validUntil = frozenTimestamp(result.validUntil, "AVAILABILITY_INVALID_VALID_UNTIL");
      if (validUntil < checkedAt.getTime()) {
        throw new Error("AVAILABILITY_VALID_UNTIL_BEFORE_CHECKED_AT");
      }
    }
    if (result.availability === "restricted") {
      if (
        result.riskLevel === undefined ||
        result.validUntil === undefined ||
        (result.earliestStartTime === undefined &&
          (result.nextAvailableWindows === undefined || result.nextAvailableWindows.length === 0))
      ) {
        throw new Error("RESTRICTED_AVAILABILITY_FIELDS_MISSING");
      }
    }
    if (result.earliestStartTime !== undefined) {
      frozenTimestamp(result.earliestStartTime, "AVAILABILITY_INVALID_EARLIEST_START");
    }
    let previousEnd = Number.NEGATIVE_INFINITY;
    if ((result.nextAvailableWindows?.length ?? 0) > 32) {
      throw new Error("AVAILABILITY_TOO_MANY_WINDOWS");
    }
    for (const window of result.nextAvailableWindows ?? []) {
      const start = frozenTimestamp(window.startTime, "INVALID_AVAILABILITY_WINDOW");
      const end = frozenTimestamp(window.endTime, "INVALID_AVAILABILITY_WINDOW");
      if (start >= end || start < previousEnd) {
        throw new Error("INVALID_AVAILABILITY_WINDOW");
      }
      previousEnd = end;
    }
    if (result.reservationMode === "guaranteed") {
      if (
        typeof result.reservationRef !== "string" ||
        result.reservationRef.length < 1 ||
        result.reservationRef.length > 256
      ) {
        throw new Error("AVAILABILITY_RESERVATION_INVALID");
      }
    } else if (result.reservationRef !== undefined) {
      throw new Error("AVAILABILITY_RESERVATION_INVALID");
    }
  }
  return { resultType: "complete", profileVersion: "1.0", results };
}

export function unknownAvailability(requested: AvailabilityCheck[]): AvailabilityResponseValue {
  return {
    resultType: "complete",
    profileVersion: "1.0",
    results: requested.map((check) => ({
      requestId: check.requestId,
      operationName: check.operationName,
      availability: "unknown",
      riskLevel: "critical",
      reasonCode: "ADAPTER_TRANSIENT_UNAVAILABLE",
      description: "Availability could not be determined; final admission still applies.",
      reservationMode: "none",
    })),
  };
}

function frozenTimestamp(value: string, reasonCode: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(reasonCode);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(reasonCode);
  return timestamp;
}
