import type { CatalogDiscoveryRequest, CatalogDiscoveryTransport } from "./model.js";
import { CatalogDiscoveryError } from "./model.js";

export interface HttpCatalogTransportOptions {
  readonly endpoint: string;
  readonly authorization?: string;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof fetch;
}

export class HttpCatalogDiscoveryTransport implements CatalogDiscoveryTransport {
  readonly #endpoint: string;
  readonly #authorization: string | undefined;
  readonly #maxResponseBytes: number;
  readonly #fetch: typeof fetch;

  constructor(options: HttpCatalogTransportOptions) {
    this.#endpoint = options.endpoint;
    this.#authorization = options.authorization;
    this.#maxResponseBytes = options.maxResponseBytes ?? 1_048_576;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async call(request: CatalogDiscoveryRequest, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          ...request.headers,
          ...(this.#authorization === undefined ? {} : { authorization: this.#authorization }),
        },
        body: JSON.stringify(request.body),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw new CatalogDiscoveryError("CATALOG_REQUEST_TIMEOUT", true, { cause: error });
      }
      throw new CatalogDiscoveryError("CATALOG_REQUEST_FAILED", true, { cause: error });
    }
    if (!response.ok) {
      throw new CatalogDiscoveryError("CATALOG_REQUEST_FAILED", response.status >= 500);
    }
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      Number.isFinite(Number(contentLength)) &&
      Number(contentLength) > this.#maxResponseBytes
    ) {
      throw new CatalogDiscoveryError("CATALOG_RESPONSE_TOO_LARGE", false);
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > this.#maxResponseBytes) {
      throw new CatalogDiscoveryError("CATALOG_RESPONSE_TOO_LARGE", false);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new CatalogDiscoveryError("CATALOG_INVALID_JSON_RPC", false, { cause: error });
    }
  }
}
