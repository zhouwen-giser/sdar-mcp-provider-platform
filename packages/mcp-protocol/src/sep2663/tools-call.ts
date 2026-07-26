import type { TaskExecutionTiming } from "../../../domain/src/index.js";
import { InvalidParamsError } from "../../../domain/src/index.js";
import type { FrozenJsonRpcRequest } from "./request-validator.js";

export interface FrozenToolCall {
  name: string;
  arguments: Record<string, unknown>;
  idempotencyKey?: string;
  timing?: TaskExecutionTiming;
  reservationRef?: string;
}

export function parseFrozenToolCall(request: FrozenJsonRpcRequest): FrozenToolCall {
  const params = request.params;
  assertOnlyKeys(params, new Set(["name", "arguments", "_meta"]));
  if (typeof params.name !== "string" || params.name.length < 1) {
    throw new InvalidParamsError("UNKNOWN_TOOL", "Unknown tool.");
  }
  const rawArguments: unknown = params.arguments;
  const argumentsValue = rawArguments === undefined ? {} : rawArguments;
  if (
    typeof argumentsValue !== "object" ||
    argumentsValue === null ||
    Array.isArray(argumentsValue)
  ) {
    throw new InvalidParamsError("INVALID_TOOL_ARGUMENTS");
  }
  assertJsonLimits(argumentsValue, 1_048_576, 32, 10_000);

  const profileValue = request.meta.raw["io.sdar/taskExecution"];
  if (profileValue === undefined) {
    return { name: params.name, arguments: argumentsValue as Record<string, unknown> };
  }
  if (typeof profileValue !== "object" || profileValue === null || Array.isArray(profileValue)) {
    throw new InvalidParamsError("INVALID_TASK_PROFILE");
  }
  const profile = profileValue as Record<string, unknown>;
  assertOnlyKeys(
    profile,
    new Set(["profileVersion", "timing", "reservationRef", "idempotencyKey"]),
  );
  if (profile.profileVersion !== "1.0") {
    throw new InvalidParamsError("INVALID_TASK_PROFILE_VERSION");
  }
  const timing = profile.timing === undefined ? undefined : parseTiming(profile.timing);
  const reservationRef = optionalBoundedString(
    profile.reservationRef,
    256,
    "INVALID_RESERVATION_REF",
  );
  const idempotencyKey = optionalBoundedString(
    profile.idempotencyKey,
    256,
    "INVALID_IDEMPOTENCY_KEY",
  );
  return {
    name: params.name,
    arguments: argumentsValue as Record<string, unknown>,
    ...(timing === undefined ? {} : { timing }),
    ...(reservationRef === undefined ? {} : { reservationRef }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  };
}

function parseTiming(value: unknown): TaskExecutionTiming {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidTiming();
  const timing = value as Record<string, unknown>;
  assertOnlyKeys(timing, new Set(["start", "maxElapsedMs"]));
  const startValue = timing.start;
  if (typeof startValue !== "object" || startValue === null || Array.isArray(startValue)) {
    invalidTiming();
  }
  const start = startValue as Record<string, unknown>;
  const tolerance = start.startToleranceMs;
  if (
    !Number.isSafeInteger(tolerance) ||
    (tolerance as number) < 0 ||
    (tolerance as number) > 86_400_000
  ) {
    invalidTiming();
  }
  let normalizedStart: TaskExecutionTiming["start"];
  if (start.mode === "immediate") {
    assertOnlyKeys(start, new Set(["mode", "startToleranceMs"]));
    normalizedStart = { mode: "immediate", startToleranceMs: tolerance as number };
  } else if (start.mode === "scheduled") {
    assertOnlyKeys(start, new Set(["mode", "scheduledAt", "startToleranceMs"]));
    if (typeof start.scheduledAt !== "string" || !isZonedRfc3339(start.scheduledAt)) {
      invalidTiming();
    }
    normalizedStart = {
      mode: "scheduled",
      scheduledAt: start.scheduledAt,
      startToleranceMs: tolerance as number,
    };
  } else {
    invalidTiming();
  }
  const maxElapsedMs = timing.maxElapsedMs;
  if (
    maxElapsedMs !== null &&
    (!Number.isSafeInteger(maxElapsedMs) ||
      (maxElapsedMs as number) < 1 ||
      (maxElapsedMs as number) > 31_536_000_000)
  ) {
    invalidTiming();
  }
  return { start: normalizedStart, maxElapsedMs: maxElapsedMs as number | null };
}

function optionalBoundedString(value: unknown, max: number, code: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new InvalidParamsError(code);
  }
  return value;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new InvalidParamsError("UNKNOWN_TOOL_CALL_FIELD");
  }
}

function assertJsonLimits(
  value: unknown,
  maxBytes: number,
  maxDepth: number,
  maxNodes: number,
): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new InvalidParamsError("TOOL_ARGUMENTS_NOT_JSON", undefined, { cause: error });
  }
  if (Buffer.byteLength(serialized) > maxBytes) {
    throw new InvalidParamsError("TOOL_ARGUMENTS_TOO_LARGE");
  }
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > maxNodes) throw new InvalidParamsError("TOOL_ARGUMENTS_TOO_COMPLEX");
    if (depth > maxDepth) throw new InvalidParamsError("TOOL_ARGUMENTS_TOO_DEEP");
    if (Array.isArray(item)) for (const child of item) visit(child, depth + 1);
    else if (typeof item === "object" && item !== null) {
      for (const child of Object.values(item)) visit(child, depth + 1);
    }
  };
  visit(value, 0);
}

function isZonedRfc3339(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function invalidTiming(): never {
  throw new InvalidParamsError("INVALID_TASK_TIMING", "Invalid Task timing parameters.");
}
