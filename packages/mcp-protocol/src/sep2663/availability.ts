import type { AvailabilityCheck } from "../../../domain/src/index.js";
import { invalidParams } from "./errors.js";
import type { FrozenJsonRpcRequest } from "./request-validator.js";

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const operationNamePattern = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$/;
const pointerPattern = /^(?:|(?:\/(?:[^~/]|~[01])*)*)$/;

export function parseFrozenAvailability(request: FrozenJsonRpcRequest): AvailabilityCheck[] {
  if (request.method !== "io.sdar/taskExecution/checkAvailability") throw invalidParams();
  exactKeys(request.params, ["profileVersion", "checks", "_meta"], true);
  if (request.params.profileVersion !== "1.0") throw invalidParams();
  if (!Array.isArray(request.params.checks)) throw invalidParams();
  if (request.params.checks.length < 1 || request.params.checks.length > 64) {
    throw invalidParams();
  }

  const ids = new Set<string>();
  return request.params.checks.map((value) => {
    const check = strictObject(value);
    if (
      typeof check.requestId !== "string" ||
      !requestIdPattern.test(check.requestId) ||
      ids.has(check.requestId)
    ) {
      throw invalidParams();
    }
    ids.add(check.requestId);
    if (
      typeof check.operationName !== "string" ||
      !operationNamePattern.test(check.operationName)
    ) {
      throw invalidParams();
    }

    const argumentsValue = strictObject(check.arguments);
    let argumentsResult: AvailabilityCheck["arguments"];
    if (argumentsValue.state === "complete") {
      exactKeys(argumentsValue, ["state", "value"]);
      const complete = strictObject(argumentsValue.value);
      assertJsonLimits(complete);
      argumentsResult = { state: "complete", value: complete };
    } else if (argumentsValue.state === "partial") {
      exactKeys(argumentsValue, ["state", "knownValue", "unresolvedPaths"]);
      const knownValue = strictObject(argumentsValue.knownValue);
      assertJsonLimits(knownValue);
      if (
        !Array.isArray(argumentsValue.unresolvedPaths) ||
        argumentsValue.unresolvedPaths.length < 1 ||
        argumentsValue.unresolvedPaths.length > 128
      ) {
        throw invalidParams();
      }
      const unresolvedPaths = argumentsValue.unresolvedPaths.map((pointer) => {
        if (typeof pointer !== "string" || pointer.length > 512 || !pointerPattern.test(pointer)) {
          throw invalidParams();
        }
        return pointer;
      });
      if (new Set(unresolvedPaths).size !== unresolvedPaths.length) throw invalidParams();
      argumentsResult = { state: "partial", knownValue, unresolvedPaths };
    } else {
      throw invalidParams();
    }

    exactKeys(check, ["requestId", "operationName", "arguments", "timing"], true);
    return {
      requestId: check.requestId,
      operationName: check.operationName,
      arguments: argumentsResult,
      ...(check.timing === undefined ? {} : { timing: parseTiming(check.timing) }),
    };
  });
}

function parseTiming(value: unknown): NonNullable<AvailabilityCheck["timing"]> {
  const timing = strictObject(value);
  exactKeys(timing, ["start", "maxElapsedMs"], true);
  const result: NonNullable<AvailabilityCheck["timing"]> = {};
  if (timing.start !== undefined) {
    const start = strictObject(timing.start);
    if (start.mode === "immediate") {
      exactKeys(start, ["mode", "startToleranceMs"], true);
      result.start = {
        mode: "immediate",
        ...(start.startToleranceMs === undefined
          ? {}
          : { startToleranceMs: boundedInteger(start.startToleranceMs, 0, 86_400_000) }),
      };
    } else if (start.mode === "scheduled") {
      exactKeys(start, ["mode", "scheduledAt", "startToleranceMs"], true);
      if (typeof start.scheduledAt !== "string" || !isZonedTimestamp(start.scheduledAt)) {
        throw invalidParams();
      }
      result.start = {
        mode: "scheduled",
        scheduledAt: start.scheduledAt,
        ...(start.startToleranceMs === undefined
          ? {}
          : { startToleranceMs: boundedInteger(start.startToleranceMs, 0, 86_400_000) }),
      };
    } else {
      throw invalidParams();
    }
  }
  if (timing.maxElapsedMs !== undefined) {
    result.maxElapsedMs =
      timing.maxElapsedMs === null ? null : boundedInteger(timing.maxElapsedMs, 1, 31_536_000_000);
  }
  return result;
}

function strictObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidParams();
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: string[],
  optionalAllowed = false,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalidParams();
  if (!optionalAllowed && allowed.some((key) => !(key in value))) throw invalidParams();
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidParams();
  }
  return value as number;
}

function isZonedTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function assertJsonLimits(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value)) > 1_048_576) throw invalidParams();
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 10_000 || depth > 32) throw invalidParams();
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
    } else if (typeof item === "object" && item !== null) {
      for (const child of Object.values(item)) visit(child, depth + 1);
    }
  };
  visit(value, 0);
}
