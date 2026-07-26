import { RuntimeConfigClientError } from "./errors.js";
import type {
  RuntimeConfigHttpPort,
  RuntimeConfigHttpRequest,
  RuntimeConfigHttpResponse,
} from "./model.js";

export interface FetchRuntimeConfigHttpOptions {
  readonly baseUrl: string;
  readonly authorization: () => Promise<string>;
  readonly maximumResponseBytes?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export class FetchRuntimeConfigHttpPort implements RuntimeConfigHttpPort {
  readonly #baseUrl: URL;
  readonly #maximumResponseBytes: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(private readonly options: FetchRuntimeConfigHttpOptions) {
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

function invalidResponse(cause?: unknown): RuntimeConfigClientError {
  return new RuntimeConfigClientError(
    "RUNTIME_CONFIG_RESPONSE_INVALID",
    "Runtime Config response is invalid",
    false,
    cause === undefined ? undefined : { cause },
  );
}
