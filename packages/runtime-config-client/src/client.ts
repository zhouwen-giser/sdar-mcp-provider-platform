import { canonicalSha256 } from "../../runtime-configuration-contract/src/index.js";
import { RuntimeConfigClientError } from "./errors.js";
import type {
  RuntimeConfigCacheArtifact,
  RuntimeConfigCacheStore,
  RuntimeConfigContentValidator,
  RuntimeConfigDocument,
  RuntimeConfigHttpPort,
  RuntimeConfigPullResult,
  RuntimeConfigTarget,
} from "./model.js";

export interface RuntimeConfigClientOptions {
  readonly timeoutMs?: number;
  readonly maximumAttempts?: number;
  readonly retryDelay?: (attempt: number) => Promise<void>;
}

export class RuntimeConfigClient {
  readonly #timeoutMs: number;
  readonly #maximumAttempts: number;
  readonly #retryDelay: (attempt: number) => Promise<void>;

  constructor(
    private readonly http: RuntimeConfigHttpPort,
    private readonly cache: RuntimeConfigCacheStore,
    private readonly validator: RuntimeConfigContentValidator,
    options: RuntimeConfigClientOptions = {},
  ) {
    this.#timeoutMs = boundedInteger(options.timeoutMs ?? 5_000, 1, 120_000, "timeoutMs");
    this.#maximumAttempts = boundedInteger(options.maximumAttempts ?? 3, 1, 10, "maximumAttempts");
    this.#retryDelay =
      options.retryDelay ??
      ((attempt) =>
        new Promise((resolve) => {
          setTimeout(resolve, Math.min(250 * 2 ** (attempt - 1), 2_000));
        }));
  }

  async pull(target: RuntimeConfigTarget): Promise<RuntimeConfigPullResult> {
    const result = await this.pullCandidate(target);
    if (result.source !== "remote") return result;
    try {
      await this.cache.write(createRuntimeConfigCacheArtifact(result.etag, result.document));
    } catch (error) {
      throw new RuntimeConfigClientError(
        "RUNTIME_CONFIG_CACHE_WRITE_FAILED",
        "Runtime Config LKG could not be committed atomically",
        false,
        { cause: error },
      );
    }
    return result;
  }

  /**
   * Fetches and validates the latest candidate without promoting it to LKG.
   * Lifecycle coordinators must call the apply handler successfully before writing
   * the returned candidate to the cache store.
   */
  async pullCandidate(target: RuntimeConfigTarget): Promise<RuntimeConfigPullResult> {
    let cached: RuntimeConfigCacheArtifact | null = null;
    let cacheFailure: RuntimeConfigClientError | undefined;
    try {
      cached = await readCache(this.cache);
      if (cached !== null) {
        const document = parseDocument(cached.document, cached.etag, this.validator);
        assertTargetIdentity(document, target);
        cached = { ...cached, document };
      }
    } catch (error) {
      cacheFailure =
        error instanceof RuntimeConfigClientError
          ? error
          : new RuntimeConfigClientError(
              "RUNTIME_CONFIG_CACHE_INVALID",
              "Runtime Config LKG could not be read safely",
              false,
              { cause: error },
            );
    }
    let failure: RuntimeConfigClientError | undefined;
    let useConditionalRequest = cached !== null;
    for (let attempt = 1; attempt <= this.#maximumAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const response = await this.http.latest({
          target,
          ...(useConditionalRequest && cached !== null ? { ifNoneMatch: cached.etag } : {}),
          signal: controller.signal,
        });
        if (response.status === 304) {
          if (cached === null) {
            failure = responseInvalid("A 304 response requires a valid local LKG");
            useConditionalRequest = false;
          } else {
            if (normalizeEtag(response.etag) !== normalizeEtag(cached.etag)) {
              failure = responseInvalid("The 304 ETag does not match local LKG");
            } else {
              return {
                source: "lkg",
                changed: false,
                etag: cached.etag,
                document: cached.document,
              };
            }
          }
        } else {
          const document = parseDocument(response.body, response.etag, this.validator);
          assertTargetIdentity(document, target);
          return {
            source: "remote",
            changed: cached?.etag !== response.etag,
            etag: response.etag,
            document,
          };
        }
      } catch (error) {
        failure = classifyPullError(error, controller.signal.aborted);
        if (!failure.retryable) break;
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < this.#maximumAttempts) await this.#retryDelay(attempt);
    }

    if (cached !== null && failure !== undefined) {
      return {
        source: "lkg",
        changed: false,
        etag: cached.etag,
        document: cached.document,
        fallbackReason: failure.code,
      };
    }
    throw (
      failure ??
      cacheFailure ??
      new RuntimeConfigClientError(
        "RUNTIME_CONFIG_PULL_UNAVAILABLE",
        "Runtime Config pull failed",
        true,
      )
    );
  }
}

function assertTargetIdentity(document: RuntimeConfigDocument, target: RuntimeConfigTarget): void {
  if (
    document.identity.environment !== target.environment ||
    document.identity.deploymentId !== target.deploymentId ||
    document.identity.instanceId !== target.instanceId
  ) {
    throw responseInvalid("Runtime Config response identity does not match the requested target");
  }
}

function parseDocument(
  input: unknown,
  etag: string,
  validator: RuntimeConfigContentValidator,
): RuntimeConfigDocument {
  if (!record(input)) throw responseInvalid("Runtime Config response must be an object");
  const checksum = normalizeEtag(etag);
  if (
    !/^[0-9a-f]{64}$/.test(checksum) ||
    input.checksum !== checksum ||
    typeof input.revisionId !== "string" ||
    !UUID.test(input.revisionId) ||
    typeof input.revision !== "number" ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !APPLY_MODES.includes(input.applyMode as never) ||
    !TARGET_TYPES.includes(input.sourceTargetType as never) ||
    !record(input.identity) ||
    !identity(input.identity) ||
    !record(input.content)
  ) {
    throw responseInvalid("Runtime Config response metadata is invalid");
  }
  const validation = validator.validate(input.content);
  if (!validation.valid) throw responseInvalid("Runtime Config content does not match its schema");
  return structuredClone(input) as unknown as RuntimeConfigDocument;
}

export function createRuntimeConfigCacheArtifact(
  etag: string,
  document: RuntimeConfigDocument,
): RuntimeConfigCacheArtifact {
  const payload = { formatVersion: 1 as const, etag, document };
  return { ...payload, artifactChecksum: canonicalSha256(payload) };
}

async function readCache(
  cache: RuntimeConfigCacheStore,
): Promise<RuntimeConfigCacheArtifact | null> {
  let input: unknown;
  try {
    input = await cache.read();
  } catch (error) {
    throw new RuntimeConfigClientError(
      "RUNTIME_CONFIG_CACHE_INVALID",
      "Runtime Config LKG could not be read safely",
      false,
      { cause: error },
    );
  }
  if (input === null) return null;
  if (
    !record(input) ||
    input.formatVersion !== 1 ||
    typeof input.etag !== "string" ||
    !record(input.document) ||
    typeof input.artifactChecksum !== "string"
  ) {
    throw cacheInvalid();
  }
  const payload = {
    formatVersion: input.formatVersion,
    etag: input.etag,
    document: input.document,
  };
  if (canonicalSha256(payload) !== input.artifactChecksum) throw cacheInvalid();
  return structuredClone(input) as unknown as RuntimeConfigCacheArtifact;
}

function classifyPullError(error: unknown, timedOut: boolean): RuntimeConfigClientError {
  if (error instanceof RuntimeConfigClientError) return error;
  return new RuntimeConfigClientError(
    timedOut ? "RUNTIME_CONFIG_PULL_TIMEOUT" : "RUNTIME_CONFIG_PULL_UNAVAILABLE",
    timedOut ? "Runtime Config pull timed out" : "Runtime Config service is unavailable",
    true,
    { cause: error },
  );
}

function responseInvalid(message: string): RuntimeConfigClientError {
  return new RuntimeConfigClientError("RUNTIME_CONFIG_RESPONSE_INVALID", message, false);
}

function cacheInvalid(): RuntimeConfigClientError {
  return new RuntimeConfigClientError(
    "RUNTIME_CONFIG_CACHE_INVALID",
    "Runtime Config LKG checksum is invalid",
    false,
  );
}

function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

function identity(value: Record<string, unknown>): boolean {
  return ["environment", "deploymentId", "instanceId", "providerId"].every(
    (field) => typeof value[field] === "string" && value[field].length > 0,
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`RUNTIME_CONFIG_CLIENT_${name.toUpperCase()}_INVALID`);
  }
  return value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPLY_MODES = ["hot_reload", "reconnect_required", "restart_required", "immutable"] as const;
const TARGET_TYPES = ["runtime_deployment", "runtime_instance"] as const;
