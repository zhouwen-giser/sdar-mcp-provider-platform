export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface TaskExecutionTiming {
  start:
    | { mode: "immediate"; startToleranceMs: number }
    | { mode: "scheduled"; scheduledAt: string; startToleranceMs: number };
  maxElapsedMs: number | null;
}

export interface TimingAnchors {
  acceptedAt: Date;
  notBefore: Date;
  latestStartAt: Date;
  deadlineAt: Date | null;
}

export const defaultTiming: TaskExecutionTiming = {
  start: { mode: "immediate", startToleranceMs: 30_000 },
  maxElapsedMs: null,
};

export function validateTiming(
  timing: TaskExecutionTiming,
  capabilities: { scheduling: boolean; maxElapsed: boolean },
  acceptedAt: Date,
): TimingAnchors {
  if (!Number.isSafeInteger(timing.start.startToleranceMs) || timing.start.startToleranceMs < 0) {
    throw new Error("INVALID_START_TOLERANCE");
  }
  if (
    timing.maxElapsedMs !== null &&
    (!Number.isSafeInteger(timing.maxElapsedMs) || timing.maxElapsedMs <= 0)
  ) {
    throw new Error("INVALID_MAX_ELAPSED");
  }
  if (timing.start.mode === "scheduled" && !capabilities.scheduling) {
    throw new Error("SCHEDULING_NOT_SUPPORTED");
  }
  if (timing.maxElapsedMs !== null && !capabilities.maxElapsed) {
    throw new Error("MAX_ELAPSED_NOT_SUPPORTED");
  }
  const notBefore =
    timing.start.mode === "scheduled" ? parseRfc3339(timing.start.scheduledAt) : acceptedAt;
  const latestStartAt = addMilliseconds(notBefore, timing.start.startToleranceMs);
  const deadlineAt =
    timing.maxElapsedMs === null ? null : addMilliseconds(notBefore, timing.maxElapsedMs);
  return { acceptedAt, notBefore, latestStartAt, deadlineAt };
}

function parseRfc3339(value: string): Date {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new Error("INVALID_SCHEDULED_AT");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("INVALID_SCHEDULED_AT");
  return parsed;
}

function addMilliseconds(value: Date, milliseconds: number): Date {
  const result = new Date(value.getTime() + milliseconds);
  if (!Number.isFinite(result.getTime())) throw new Error("TIMING_OVERFLOW");
  return result;
}
