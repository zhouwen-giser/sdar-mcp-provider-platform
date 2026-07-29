import type {
  RuntimeInfrastructureInstanceTarget,
  RuntimeInfrastructureProcessState,
} from "@sdar/runtime-deployment";
import type { Pm2ProcessManager } from "../pm2/process-manager.js";

export type RuntimeHealthReasonCode =
  | "HEALTHY"
  | "PROCESS_NOT_ONLINE"
  | "PROCESS_UNAVAILABLE"
  | "LIVE_TIMEOUT"
  | "LIVE_UNAVAILABLE"
  | "LIVE_INVALID_RESPONSE"
  | "READINESS_TIMEOUT"
  | "READINESS_UNAVAILABLE"
  | "READINESS_INVALID_RESPONSE"
  | "DATABASE_NOT_READY"
  | "ADAPTER_NOT_READY"
  | "DEPENDENCY_NOT_READY";

export interface RuntimeHealthProbeRequest {
  readonly target: RuntimeInfrastructureInstanceTarget;
  readonly httpPort: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface RuntimeHealthProbeResult {
  readonly target: RuntimeInfrastructureInstanceTarget;
  readonly processState: RuntimeInfrastructureProcessState;
  readonly live: boolean;
  readonly ready: boolean;
  readonly reasonCode: RuntimeHealthReasonCode;
  readonly checkedAt: string;
}

export type RuntimeHealthProbeErrorCode =
  "RUNTIME_HEALTH_PROBE_INVALID_INPUT" | "RUNTIME_HEALTH_PROBE_CANCELLED";

export class RuntimeHealthProbeError extends Error {
  constructor(readonly code: RuntimeHealthProbeErrorCode) {
    super(code);
    this.name = "RuntimeHealthProbeError";
  }
}

export interface RuntimeHealthProbeOptions {
  readonly host?: "127.0.0.1" | "::1";
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

export class RuntimeHealthProbe {
  readonly #host: "127.0.0.1" | "::1";
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => Date;

  constructor(
    private readonly processes: Pick<Pm2ProcessManager, "describe">,
    options: RuntimeHealthProbeOptions = {},
  ) {
    this.#host = options.host ?? "127.0.0.1";
    if (!["127.0.0.1", "::1"].includes(this.#host)) {
      throw new RuntimeHealthProbeError("RUNTIME_HEALTH_PROBE_INVALID_INPUT");
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async probe(request: RuntimeHealthProbeRequest): Promise<RuntimeHealthProbeResult> {
    validateRequest(request);
    let processState: RuntimeInfrastructureProcessState;
    try {
      processState = (await this.processes.describe(request.target.processName)).state;
    } catch {
      return this.result(request, "errored", false, false, "PROCESS_UNAVAILABLE");
    }
    if (processState !== "online") {
      return this.result(request, processState, false, false, "PROCESS_NOT_ONLINE");
    }

    const live = await this.request(request, "/health/live", "live");
    if (!live.ok) {
      return this.result(request, processState, false, false, live.reasonCode);
    }
    const readiness = await this.request(request, "/health/ready", "ready");
    if (!readiness.ok) {
      return this.result(request, processState, true, false, readiness.reasonCode);
    }
    if (!("dependencies" in readiness.body)) {
      return this.result(request, processState, true, false, "READINESS_INVALID_RESPONSE");
    }
    if (readiness.body.status === "ready") {
      return this.result(request, processState, true, true, "HEALTHY");
    }
    return this.result(
      request,
      processState,
      true,
      false,
      classifyDependencies(readiness.body.dependencies),
    );
  }

  private async request(
    request: RuntimeHealthProbeRequest,
    path: "/health/live" | "/health/ready",
    kind: "live" | "ready",
  ): Promise<ProbeHttpResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), request.timeoutMs);
    const cancel = () => controller.abort("cancelled");
    request.signal.addEventListener("abort", cancel, { once: true });
    try {
      const response = await this.#fetch(this.url(request.httpPort, path), {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        return failed(invalidResponse(kind));
      }
      const text = await response.text();
      if (text.length === 0 || text.length > 65_536) {
        return failed(invalidResponse(kind));
      }
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return failed(invalidResponse(kind));
      }
      if (kind === "live") {
        if (response.status !== 200 || !validLive(value)) {
          return failed(response.status === 200 ? "LIVE_INVALID_RESPONSE" : "LIVE_UNAVAILABLE");
        }
        return { ok: true, body: value };
      }
      if (![200, 503].includes(response.status) || !validReady(value)) {
        return failed(
          [200, 503].includes(response.status)
            ? "READINESS_INVALID_RESPONSE"
            : "READINESS_UNAVAILABLE",
        );
      }
      if (
        (response.status === 200 && value.status !== "ready") ||
        (response.status === 503 && value.status !== "not_ready")
      ) {
        return failed("READINESS_INVALID_RESPONSE");
      }
      return { ok: true, body: value };
    } catch {
      if (request.signal.aborted) {
        throw new RuntimeHealthProbeError("RUNTIME_HEALTH_PROBE_CANCELLED");
      }
      return failed(
        controller.signal.reason === "timeout"
          ? kind === "live"
            ? "LIVE_TIMEOUT"
            : "READINESS_TIMEOUT"
          : kind === "live"
            ? "LIVE_UNAVAILABLE"
            : "READINESS_UNAVAILABLE",
      );
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", cancel);
    }
  }

  private url(port: number, path: string): string {
    const host = this.#host === "::1" ? "[::1]" : this.#host;
    return `http://${host}:${String(port)}${path}`;
  }

  private result(
    request: RuntimeHealthProbeRequest,
    processState: RuntimeInfrastructureProcessState,
    live: boolean,
    ready: boolean,
    reasonCode: RuntimeHealthReasonCode,
  ): RuntimeHealthProbeResult {
    return Object.freeze({
      target: request.target,
      processState,
      live,
      ready,
      reasonCode,
      checkedAt: this.#now().toISOString(),
    });
  }
}

type DependencyState = "disabled" | "starting" | "ready" | "degraded" | "failed";

interface LiveBody {
  readonly status: "live";
}

interface ReadyBody {
  readonly status: "ready" | "not_ready";
  readonly dependencies: Readonly<
    Record<string, DependencyState | Readonly<Record<string, DependencyState>>>
  >;
}

const DEPENDENCY_KEYS = new Set([
  "database",
  "adapter",
  "adapterManifest",
  "recovery",
  "scheduler",
  "commandDispatcher",
  "ttlCleaner",
  "outboxPublisher",
  "outboxCleaner",
  "providerTelemetryIngress",
  "businessEventPersistence",
  "businessEventReplay",
  "businessEventIngest",
  "businessEventFinalizer",
  "businessEventAdapterSources",
  "businessEventRetention",
  "businessEventProjection",
]);

type ProbeHttpResult =
  | { readonly ok: true; readonly body: LiveBody | ReadyBody }
  | { readonly ok: false; readonly reasonCode: RuntimeHealthReasonCode };

function validateRequest(request: RuntimeHealthProbeRequest): void {
  if (
    !Number.isSafeInteger(request.httpPort) ||
    request.httpPort < 1 ||
    request.httpPort > 65_535 ||
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < 1 ||
    request.timeoutMs > 30_000
  ) {
    throw new RuntimeHealthProbeError("RUNTIME_HEALTH_PROBE_INVALID_INPUT");
  }
  if (request.signal.aborted) {
    throw new RuntimeHealthProbeError("RUNTIME_HEALTH_PROBE_CANCELLED");
  }
}

function validLive(value: unknown): value is LiveBody {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    "status" in value &&
    value.status === "live"
  );
}

function validReady(value: unknown): value is ReadyBody {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    !["ready", "not_ready"].includes(String(value.status)) ||
    !("dependencies" in value) ||
    typeof value.dependencies !== "object" ||
    value.dependencies === null ||
    Array.isArray(value.dependencies) ||
    Object.keys(value).some((key) => !["status", "dependencies"].includes(key))
  ) {
    return false;
  }
  const rawDependencies = value.dependencies;
  const dependencies = Object.entries(rawDependencies);
  if (
    !["database", "adapter", "adapterManifest"].every((key) => key in rawDependencies) ||
    dependencies.some(([key]) => !DEPENDENCY_KEYS.has(key))
  ) {
    return false;
  }
  return dependencies.every(([key, state]) =>
    key === "businessEventAdapterSources"
      ? validSourceDependencies(state)
      : validDependencyState(state),
  );
}

function classifyDependencies(dependencies: ReadyBody["dependencies"]): RuntimeHealthReasonCode {
  if (dependencies.database !== "ready") return "DATABASE_NOT_READY";
  if (dependencies.adapter !== "ready" || dependencies.adapterManifest !== "ready") {
    return "ADAPTER_NOT_READY";
  }
  return "DEPENDENCY_NOT_READY";
}

function validSourceDependencies(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(validDependencyState)
  );
}

function validDependencyState(value: unknown): value is DependencyState {
  return ["disabled", "starting", "ready", "degraded", "failed"].includes(String(value));
}

function invalidResponse(kind: "live" | "ready"): RuntimeHealthReasonCode {
  return kind === "live" ? "LIVE_INVALID_RESPONSE" : "READINESS_INVALID_RESPONSE";
}

function failed(reasonCode: RuntimeHealthReasonCode): ProbeHttpResult {
  return { ok: false, reasonCode };
}
