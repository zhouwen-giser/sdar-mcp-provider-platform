import type { Attributes } from "@opentelemetry/api";

const ALLOWED_SENSITIVE_HASH_KEYS = new Set(["argumenthash", "authorizationcontexthash"]);
const FORBIDDEN_EXACT_KEYS = new Set([
  "adapterpayload",
  "answer",
  "answers",
  "argument",
  "arguments",
  "input",
  "inputs",
  "inputvalue",
  "inputvalues",
]);
const FORBIDDEN_KEY_PARTS = [
  "password",
  "passwd",
  "secret",
  "apikey",
  "cookie",
  "authorization",
  "token",
  "jwt",
];
const CREDENTIAL_ASSIGNMENT =
  /\b(password|passwd|secret|client_secret|api_key|apikey|cookie|set-cookie|authorization|token)\s*([=:])\s*([^\s,;&]+)/gi;

export interface TelemetrySanitizerOptions {
  maxDepth?: number;
  maxNodes?: number;
  maxStringBytes?: number;
  maxTotalBytes?: number;
}

interface SanitizeState {
  seen: WeakSet<object>;
  nodes: number;
  totalBytes: number;
  limits: Required<TelemetrySanitizerOptions>;
}

export class TelemetrySanitizer {
  readonly #limits: Required<TelemetrySanitizerOptions>;

  constructor(options: TelemetrySanitizerOptions = {}) {
    this.#limits = {
      maxDepth: options.maxDepth ?? 16,
      maxNodes: options.maxNodes ?? 4_096,
      maxStringBytes: options.maxStringBytes ?? 4_096,
      maxTotalBytes: options.maxTotalBytes ?? 65_536,
    };
    for (const value of Object.values(this.#limits)) {
      if (!Number.isInteger(value) || value < 1) throw new RangeError("SANITIZER_LIMIT_INVALID");
    }
  }

  sanitize(value: unknown): unknown {
    return sanitizeValue(value, 0, {
      seen: new WeakSet(),
      nodes: 0,
      totalBytes: 0,
      limits: this.#limits,
    });
  }

  sanitizeAttributes(attributes: Attributes): Attributes {
    const sanitized = this.sanitize(attributes);
    return isRecord(sanitized) ? (sanitized as Attributes) : {};
  }
}

function sanitizeValue(value: unknown, depth: number, state: SanitizeState): unknown {
  state.nodes += 1;
  if (
    depth > state.limits.maxDepth ||
    state.nodes > state.limits.maxNodes ||
    state.totalBytes >= state.limits.maxTotalBytes
  ) {
    return "[TRUNCATED]";
  }
  if (typeof value === "string") return boundedString(redactCredentialText(value), state);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return boundedString(value.toString(), state);
  if (typeof value !== "object") return undefined;
  if (state.seen.has(value)) return "[REDACTED_CIRCULAR]";
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, depth + 1, state));
    }
    if (value instanceof Map) {
      const result: Record<string, unknown> = {};
      for (const [key, child] of value.entries()) {
        const safeKey = String(key);
        if (forbiddenKey(safeKey)) continue;
        result[safeKey] = sanitizeValue(child, depth + 1, state);
      }
      return result;
    }
    if (value instanceof Set) {
      return [...value].map((item) => sanitizeValue(item, depth + 1, state));
    }
    if (!isRecord(value)) return undefined;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      state.totalBytes += Buffer.byteLength(key, "utf8");
      if (state.totalBytes >= state.limits.maxTotalBytes) {
        result.__truncated__ = "[TRUNCATED]";
        break;
      }
      if (forbiddenKey(key)) continue;
      result[key] = sanitizeValue(child, depth + 1, state);
    }
    return result;
  } finally {
    state.seen.delete(value);
  }
}

function boundedString(value: string, state: SanitizeState): string {
  const remaining = Math.max(0, state.limits.maxTotalBytes - state.totalBytes);
  const maximum = Math.min(state.limits.maxStringBytes, remaining);
  const bytes = Buffer.from(value, "utf8");
  state.totalBytes += Math.min(bytes.length, maximum);
  if (bytes.length <= maximum) return value;
  if (maximum < 14) return "[TRUNCATED]";
  return `${bytes.subarray(0, maximum - 13).toString("utf8")}[TRUNCATED]`;
}

function forbiddenKey(key: string): boolean {
  const normalized = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
  if (ALLOWED_SENSITIVE_HASH_KEYS.has(normalized)) return false;
  return (
    FORBIDDEN_EXACT_KEYS.has(normalized) ||
    FORBIDDEN_KEY_PARTS.some((part) => normalized.includes(part))
  );
}

function redactCredentialText(value: string): string {
  return value
    .replaceAll(CREDENTIAL_ASSIGNMENT, "$1$2[REDACTED]")
    .replaceAll(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replaceAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
