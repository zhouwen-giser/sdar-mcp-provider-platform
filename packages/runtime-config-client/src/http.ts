import { RuntimeConfigClientError } from "./errors.js";
import type {
  RuntimeConfigAcknowledgement,
  RuntimeConfigAcknowledgementPort,
  RuntimeConfigHttpPort,
  RuntimeConfigHttpRequest,
  RuntimeConfigHttpResponse,
  RuntimeConfigTarget,
  RuntimeConfigWatchHint,
  RuntimeConfigWatchPort,
} from "./model.js";

export interface FetchRuntimeConfigOptions {
  readonly baseUrl: string;
  readonly authorization: () => Promise<string>;
  readonly maximumResponseBytes?: number;
  readonly requestTimeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export type FetchRuntimeConfigHttpOptions = FetchRuntimeConfigOptions;

export class FetchRuntimeConfigHttpPort implements RuntimeConfigHttpPort {
  readonly #baseUrl: URL;
  readonly #maximumResponseBytes: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(private readonly options: FetchRuntimeConfigOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(this.#baseUrl.protocol)) {
      throw new RangeError("RUNTIME_CONFIG_BASE_URL_INVALID");
    }
    this.#maximumResponseBytes = options.maximumResponseBytes ?? 1_048_576;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async latest(request: RuntimeConfigHttpRequest): Promise<RuntimeConfigHttpResponse> {
    const url = new URL(
      `/api/v1/runtime-config/deployments/${encodeURIComponent(request.target.deploymentId)}/instances/${encodeURIComponent(request.target.instanceId)}/latest`,
      this.#baseUrl,
    );
    url.searchParams.set("environment", request.target.environment);
    url.searchParams.set("configGroup", request.target.configGroup);
    url.searchParams.set("dataId", request.target.dataId);
    const response = await this.#fetch(url, {
      method: "GET",
      signal: request.signal,
      headers: {
        authorization: await this.options.authorization(),
        accept: "application/json",
        ...(request.ifNoneMatch === undefined ? {} : { "if-none-match": request.ifNoneMatch }),
      },
    });
    const etag = response.headers.get("etag");
    if (etag === null) throw invalidResponse();
    if (response.status === 304) return { status: 304, etag };
    if (response.status !== 200) {
      throw new RuntimeConfigClientError(
        "RUNTIME_CONFIG_PULL_UNAVAILABLE",
        "Runtime Config service returned an unavailable response",
        response.status >= 500 || response.status === 429,
      );
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > this.#maximumResponseBytes) throw invalidResponse();
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > this.#maximumResponseBytes) throw invalidResponse();
    try {
      return { status: 200, etag, body: JSON.parse(text) as unknown };
    } catch (error) {
      throw invalidResponse(error);
    }
  }
}

export class FetchRuntimeConfigWatchPort implements RuntimeConfigWatchPort {
  readonly #baseUrl: URL;
  readonly #maximumResponseBytes: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(private readonly options: FetchRuntimeConfigOptions) {
    this.#baseUrl = validatedBaseUrl(options.baseUrl);
    this.#maximumResponseBytes = options.maximumResponseBytes ?? 65_536;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async *watch(
    target: RuntimeConfigTarget,
    signal: AbortSignal,
  ): AsyncIterable<RuntimeConfigWatchHint> {
    const response = await this.#fetch(runtimeConfigUrl(this.#baseUrl, target, "watch"), {
      method: "GET",
      signal,
      headers: {
        authorization: await this.options.authorization(),
        accept: "text/event-stream",
      },
    });
    if (
      response.status !== 200 ||
      response.body === null ||
      !response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")
    ) {
      throw unavailableResponse(response.status);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) return;
        buffer += chunk.value;
        if (Buffer.byteLength(buffer, "utf8") > this.#maximumResponseBytes) {
          throw invalidResponse();
        }
        let boundary = frameBoundary(buffer);
        while (boundary !== null) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary.length);
          const hint = parseHint(frame);
          if (hint !== null) yield hint;
          boundary = frameBoundary(buffer);
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}

export class FetchRuntimeConfigAcknowledgementPort implements RuntimeConfigAcknowledgementPort {
  readonly #baseUrl: URL;
  readonly #fetch: typeof globalThis.fetch;

  constructor(private readonly options: FetchRuntimeConfigOptions) {
    this.#baseUrl = validatedBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async acknowledge(
    target: RuntimeConfigTarget,
    acknowledgement: RuntimeConfigAcknowledgement,
  ): Promise<void> {
    const base = runtimeConfigUrl(this.#baseUrl, target, "revisions");
    const url = new URL(
      `${base.pathname}/${encodeURIComponent(acknowledgement.revisionId)}/acks${base.search}`,
      base,
    );
    const controller = new AbortController();
    const timeoutMs = this.options.requestTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new RangeError("RUNTIME_CONFIG_REQUEST_TIMEOUT_INVALID");
    }
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: await this.options.authorization(),
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: acknowledgement.status,
          ...(acknowledgement.appliedChecksum === undefined
            ? {}
            : { appliedChecksum: acknowledgement.appliedChecksum }),
          ...(acknowledgement.reasonCode === undefined
            ? {}
            : { reasonCode: acknowledgement.reasonCode }),
          ...(acknowledgement.details === undefined ? {} : { details: acknowledgement.details }),
        }),
      });
      if (response.status !== 200) throw unavailableResponse(response.status);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function invalidResponse(cause?: unknown): RuntimeConfigClientError {
  return new RuntimeConfigClientError(
    "RUNTIME_CONFIG_RESPONSE_INVALID",
    "Runtime Config response is invalid",
    false,
    cause === undefined ? undefined : { cause },
  );
}

function unavailableResponse(status: number): RuntimeConfigClientError {
  return new RuntimeConfigClientError(
    "RUNTIME_CONFIG_PULL_UNAVAILABLE",
    "Runtime Config service returned an unavailable response",
    status >= 500 || status === 429,
  );
}

function validatedBaseUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new RangeError("RUNTIME_CONFIG_BASE_URL_INVALID");
  }
  return url;
}

function runtimeConfigUrl(
  baseUrl: URL,
  target: RuntimeConfigTarget,
  action: "watch" | "revisions",
): URL {
  const url = new URL(
    `/api/v1/runtime-config/deployments/${encodeURIComponent(target.deploymentId)}/instances/${encodeURIComponent(target.instanceId)}/${action}`,
    baseUrl,
  );
  url.searchParams.set("environment", target.environment);
  url.searchParams.set("configGroup", target.configGroup);
  url.searchParams.set("dataId", target.dataId);
  return url;
}

function frameBoundary(value: string): { readonly index: number; readonly length: number } | null {
  const unix = value.indexOf("\n\n");
  const windows = value.indexOf("\r\n\r\n");
  if (unix < 0 && windows < 0) return null;
  if (windows >= 0 && (unix < 0 || windows < unix)) return { index: windows, length: 4 };
  return { index: unix, length: 2 };
}

function parseHint(frame: string): RuntimeConfigWatchHint | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (data.length === 0) return null;
  let input: unknown;
  try {
    input = JSON.parse(data) as unknown;
  } catch (error) {
    throw invalidResponse(error);
  }
  if (
    !record(input) ||
    typeof input.revisionId !== "string" ||
    typeof input.revision !== "number" ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    typeof input.checksum !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.checksum)
  ) {
    throw invalidResponse();
  }
  return {
    revisionId: input.revisionId,
    revision: input.revision,
    checksum: input.checksum,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
