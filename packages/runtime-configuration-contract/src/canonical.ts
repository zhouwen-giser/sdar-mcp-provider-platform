import { createHash } from "node:crypto";

export type CanonicalJsonErrorCode = "CANONICAL_JSON_CYCLE" | "CANONICAL_JSON_VALUE_INVALID";

export class CanonicalJsonError extends Error {
  readonly code: CanonicalJsonErrorCode;

  constructor(code: CanonicalJsonErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CanonicalJsonError";
    this.code = code;
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set<object>()));
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function normalize(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw invalidValue("Canonical JSON does not support non-finite numbers");
  }
  if (typeof value !== "object") {
    throw invalidValue(`Canonical JSON does not support ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new CanonicalJsonError("CANONICAL_JSON_CYCLE", "Canonical JSON does not support cycles");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalize(item, ancestors));
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidValue("Canonical JSON supports only plain objects and arrays");
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareText)
        .map((key) => [key, normalize((value as Record<string, unknown>)[key], ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function invalidValue(message: string): CanonicalJsonError {
  return new CanonicalJsonError("CANONICAL_JSON_VALUE_INVALID", message);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
