import type {
  RuntimeHeartbeatRequest,
  RuntimeRegistrationReadiness,
  RuntimeRegistrationRequest,
} from "./model.js";

export type RuntimeRegistrationClientErrorCode =
  | "RUNTIME_REGISTRATION_CLIENT_INVALID_CONFIG"
  | "RUNTIME_REGISTRATION_CLIENT_UNAUTHORIZED"
  | "RUNTIME_REGISTRATION_CLIENT_REJECTED"
  | "RUNTIME_REGISTRATION_CLIENT_UNAVAILABLE"
  | "RUNTIME_REGISTRATION_CLIENT_INVALID_RESPONSE";

export class RuntimeRegistrationClientError extends Error {
  constructor(
    readonly code: RuntimeRegistrationClientErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "RuntimeRegistrationClientError";
  }
}

export interface RuntimeRegistrationTransportContext {
  readonly correlationId: string;
  readonly signal: AbortSignal;
}

export interface RuntimeRegistrationTransport {
  register(
    request: RuntimeRegistrationRequest,
    context: RuntimeRegistrationTransportContext,
  ): Promise<void>;
  heartbeat(
    request: RuntimeHeartbeatRequest,
    context: RuntimeRegistrationTransportContext,
  ): Promise<void>;
}

export interface FetchRuntimeRegistrationTransportOptions {
  readonly baseUrl: string;
  readonly authorization: () => Promise<string>;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export class FetchRuntimeRegistrationTransport implements RuntimeRegistrationTransport {
  readonly #baseUrl: URL;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(private readonly options: FetchRuntimeRegistrationTransportOptions) {
    this.#baseUrl = validBaseUrl(options.baseUrl);
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 100 ||
      this.#timeoutMs > 120_000
    ) {
      throw new RuntimeRegistrationClientError("RUNTIME_REGISTRATION_CLIENT_INVALID_CONFIG", false);
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  register(
    request: RuntimeRegistrationRequest,
    context: RuntimeRegistrationTransportContext,
  ): Promise<void> {
    return this.send({ action: "register", request }, context);
  }

  heartbeat(
    request: RuntimeHeartbeatRequest,
    context: RuntimeRegistrationTransportContext,
  ): Promise<void> {
    return this.send({ action: "heartbeat", request }, context);
  }

  private async send(
    input:
      | { readonly action: "register"; readonly request: RuntimeRegistrationRequest }
      | { readonly action: "heartbeat"; readonly request: RuntimeHeartbeatRequest },
    context: RuntimeRegistrationTransportContext,
  ): Promise<void> {
    const { action, request } = input;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), this.#timeoutMs);
    const cancel = () => controller.abort("cancelled");
    context.signal.addEventListener("abort", cancel, { once: true });
    const url = new URL(
      `/api/v1/runtime-registration/deployments/${encodeURIComponent(
        request.deploymentId,
      )}/instances/${encodeURIComponent(request.instanceId)}/${action}`,
      this.#baseUrl,
    );
    try {
      const response = await this.#fetch(url, {
        method: "POST",
        signal: controller.signal,
        redirect: "error",
        headers: {
          authorization: await this.options.authorization(),
          "x-correlation-id": context.correlationId,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(
          input.action === "register"
            ? registrationBody(input.request)
            : heartbeatBody(input.request),
        ),
      });
      if (response.status === 200) {
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().startsWith("application/json")) {
          throw new RuntimeRegistrationClientError(
            "RUNTIME_REGISTRATION_CLIENT_INVALID_RESPONSE",
            false,
          );
        }
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > 65_536 || !validSuccessResponse(text)) {
          throw new RuntimeRegistrationClientError(
            "RUNTIME_REGISTRATION_CLIENT_INVALID_RESPONSE",
            false,
          );
        }
        return;
      }
      if ([401, 403].includes(response.status)) {
        throw new RuntimeRegistrationClientError("RUNTIME_REGISTRATION_CLIENT_UNAUTHORIZED", false);
      }
      if (response.status === 429 || response.status >= 500) {
        throw new RuntimeRegistrationClientError("RUNTIME_REGISTRATION_CLIENT_UNAVAILABLE", true);
      }
      throw new RuntimeRegistrationClientError("RUNTIME_REGISTRATION_CLIENT_REJECTED", false);
    } catch (error) {
      if (error instanceof RuntimeRegistrationClientError) throw error;
      if (context.signal.aborted) {
        throw new RuntimeRegistrationClientError("RUNTIME_REGISTRATION_CLIENT_UNAVAILABLE", false);
      }
      throw new RuntimeRegistrationClientError("RUNTIME_REGISTRATION_CLIENT_UNAVAILABLE", true);
    } finally {
      clearTimeout(timeout);
      context.signal.removeEventListener("abort", cancel);
    }
  }
}

export interface RuntimeHeartbeatLoopObservation {
  readonly configRevision: number;
  readonly readinessState: RuntimeRegistrationReadiness;
}

export interface RuntimeHeartbeatLoopOptions {
  readonly intervalMs?: number;
  readonly correlationId: () => string;
  readonly observe: () => RuntimeHeartbeatLoopObservation;
  readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly onUnavailable?: (input: {
    readonly code: RuntimeRegistrationClientErrorCode;
    readonly retryable: boolean;
  }) => void;
}

export class RuntimeHeartbeatLoop {
  readonly #intervalMs: number;
  readonly #delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  constructor(
    private readonly transport: RuntimeRegistrationTransport,
    private readonly registration: Omit<
      RuntimeRegistrationRequest,
      "configRevision" | "readinessState"
    >,
    private readonly options: RuntimeHeartbeatLoopOptions,
  ) {
    this.#intervalMs = options.intervalMs ?? 10_000;
    if (
      !Number.isSafeInteger(this.#intervalMs) ||
      this.#intervalMs < 100 ||
      this.#intervalMs > 120_000
    ) {
      throw new RuntimeRegistrationClientError("RUNTIME_REGISTRATION_CLIENT_INVALID_CONFIG", false);
    }
    this.#delay = options.delay ?? abortableDelay;
  }

  async run(signal: AbortSignal): Promise<void> {
    let registered = false;
    let sequence = 0;
    let failures = 0;
    while (!signal.aborted) {
      const observation = this.options.observe();
      try {
        if (!registered) {
          await this.transport.register(
            { ...this.registration, ...observation },
            { correlationId: this.options.correlationId(), signal },
          );
          registered = true;
        } else {
          const candidateSequence = sequence + 1;
          await this.transport.heartbeat(
            { ...this.registration, ...observation, sequence: candidateSequence },
            { correlationId: this.options.correlationId(), signal },
          );
          sequence = candidateSequence;
        }
        failures = 0;
        await this.#delay(this.#intervalMs, signal);
      } catch (error) {
        if (isAborted(signal)) return;
        const mapped =
          error instanceof RuntimeRegistrationClientError
            ? error
            : new RuntimeRegistrationClientError("RUNTIME_REGISTRATION_CLIENT_UNAVAILABLE", true);
        this.options.onUnavailable?.({ code: mapped.code, retryable: mapped.retryable });
        failures += 1;
        if (!mapped.retryable) registered = false;
        await this.#delay(backoff(failures), signal);
      }
    }
  }
}

function registrationBody(request: RuntimeRegistrationRequest): Readonly<Record<string, unknown>> {
  return {
    providerId: request.providerId,
    sessionId: request.sessionId,
    runtimeVersion: request.runtimeVersion,
    protocolVersion: request.protocolVersion,
    configRevision: request.configRevision,
    readinessState: request.readinessState,
  };
}

function heartbeatBody(request: RuntimeHeartbeatRequest): Readonly<Record<string, unknown>> {
  return { ...registrationBody(request), sequence: request.sequence };
}

function validBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RuntimeRegistrationClientError("RUNTIME_REGISTRATION_CLIENT_INVALID_CONFIG", false);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new RuntimeRegistrationClientError("RUNTIME_REGISTRATION_CLIENT_INVALID_CONFIG", false);
  }
  return url;
}

function validSuccessResponse(text: string): boolean {
  try {
    const value = JSON.parse(text) as unknown;
    return (
      typeof value === "object" &&
      value !== null &&
      "outcome" in value &&
      ["created", "updated", "unchanged"].includes(String(value.outcome)) &&
      "registration" in value &&
      typeof value.registration === "object" &&
      value.registration !== null
    );
  } catch {
    return false;
  }
}

function backoff(failures: number): number {
  return Math.min(500 * 2 ** Math.min(Math.max(failures - 1, 0), 6), 30_000);
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveDelay) => {
    const timer = setTimeout(finish, milliseconds);
    const abort = () => finish();
    signal.addEventListener("abort", abort, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolveDelay();
    }
  });
}
