import type { RuntimeReconcileHealthResult } from "../../../packages/pms-application/src/index.js";

export interface ExternalRuntimeHealthProbeOptions {
  readonly allowInsecureInternalTransport?: boolean;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

/** Observes an externally managed Runtime strictly through its declared control endpoint. */
export class ExternalRuntimeHealthProbe {
  readonly #allowInsecureInternalTransport: boolean;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => Date;

  constructor(options: ExternalRuntimeHealthProbeOptions = {}) {
    this.#allowInsecureInternalTransport = options.allowInsecureInternalTransport === true;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async probe(input: {
    readonly controlEndpoint: string;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<RuntimeReconcileHealthResult> {
    const endpoint = controlEndpoint(input.controlEndpoint, this.#allowInsecureInternalTransport);
    validateInput(input);
    const live = await this.#request(endpoint, "/health/live", input);
    if (!live.ok) return this.#result(false, false, live.reasonCode);
    const ready = await this.#request(endpoint, "/health/ready", input);
    if (!ready.ok) return this.#result(true, false, ready.reasonCode);
    if (
      ready.body.status !== "ready" ||
      typeof ready.body.dependencies !== "object" ||
      ready.body.dependencies === null ||
      Array.isArray(ready.body.dependencies)
    ) {
      return this.#result(true, false, "READINESS_INVALID_RESPONSE");
    }
    return this.#result(true, true, "HEALTHY");
  }

  async #request(
    endpoint: URL,
    path: "/health/live" | "/health/ready",
    input: { readonly timeoutMs: number; readonly signal: AbortSignal },
  ): Promise<ProbeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), input.timeoutMs);
    const cancel = () => controller.abort("cancelled");
    input.signal.addEventListener("abort", cancel, { once: true });
    try {
      const response = await this.#fetch(endpointUrl(endpoint, path), {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text();
      if (
        !contentType.toLowerCase().startsWith("application/json") ||
        text.length === 0 ||
        text.length > 65_536
      ) {
        return { ok: false, reasonCode: invalidResponse(path) };
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return { ok: false, reasonCode: invalidResponse(path) };
      }
      if (!isRecord(body)) return { ok: false, reasonCode: invalidResponse(path) };
      if (path === "/health/live") {
        if (response.status !== 200 || body.status !== "live") {
          return {
            ok: false,
            reasonCode: response.status === 200 ? "LIVE_INVALID_RESPONSE" : "LIVE_UNAVAILABLE",
          };
        }
        return { ok: true, body };
      }
      if (![200, 503].includes(response.status)) {
        return { ok: false, reasonCode: "READINESS_UNAVAILABLE" };
      }
      if (
        (response.status === 200 && body.status !== "ready") ||
        (response.status === 503 && body.status !== "not_ready")
      ) {
        return { ok: false, reasonCode: "READINESS_INVALID_RESPONSE" };
      }
      return { ok: true, body };
    } catch {
      if (input.signal.aborted) throw new Error("EXTERNAL_RUNTIME_HEALTH_CANCELLED");
      return {
        ok: false,
        reasonCode:
          controller.signal.reason === "timeout"
            ? path === "/health/live"
              ? "LIVE_TIMEOUT"
              : "READINESS_TIMEOUT"
            : path === "/health/live"
              ? "LIVE_UNAVAILABLE"
              : "READINESS_UNAVAILABLE",
      };
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", cancel);
    }
  }

  #result(live: boolean, ready: boolean, reasonCode: string): RuntimeReconcileHealthResult {
    return Object.freeze({
      processState: live ? "online" : "errored",
      live,
      ready,
      reasonCode,
      checkedAt: this.#now().toISOString(),
    });
  }
}

function controlEndpoint(source: string, allowInsecureInternalTransport: boolean): URL {
  let url: URL;
  try {
    url = new URL(source);
  } catch (error) {
    throw new Error("EXTERNAL_RUNTIME_CONTROL_ENDPOINT_INVALID", { cause: error });
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && (loopback || allowInsecureInternalTransport))) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("EXTERNAL_RUNTIME_CONTROL_ENDPOINT_INVALID");
  }
  return url;
}

function endpointUrl(endpoint: URL, path: string): string {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  return url.toString();
}

function validateInput(input: { readonly timeoutMs: number; readonly signal: AbortSignal }): void {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 60_000) {
    throw new Error("EXTERNAL_RUNTIME_HEALTH_INPUT_INVALID");
  }
  if (input.signal.aborted) throw new Error("EXTERNAL_RUNTIME_HEALTH_CANCELLED");
}

function invalidResponse(path: "/health/live" | "/health/ready") {
  return path === "/health/live" ? "LIVE_INVALID_RESPONSE" : "READINESS_INVALID_RESPONSE";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ProbeResult =
  | { readonly ok: true; readonly body: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reasonCode: string };
