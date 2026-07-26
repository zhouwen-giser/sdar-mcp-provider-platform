import type {
  CreateProviderInput,
  Page,
  ProviderPackageSummary,
  ProviderSummary,
  ResourceSummary,
} from "./model.js";

export interface PmsWebClientOptions {
  readonly baseUrl?: string;
  readonly authorization?: () => string | undefined;
  readonly actorId?: () => string | undefined;
  readonly fetch?: typeof fetch;
}

export class PmsWebApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "PmsWebApiError";
  }
}

export class PmsWebApiClient {
  readonly #baseUrl: string;
  readonly #authorization: () => string | undefined;
  readonly #actorId: () => string | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: PmsWebClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.#authorization = options.authorization ?? (() => undefined);
    this.#actorId = options.actorId ?? (() => undefined);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async providers(): Promise<Page<ProviderSummary>> {
    const input = await this.#request("/api/v1/providers?limit=100");
    return page(input, provider);
  }

  async provider(providerId: string): Promise<ProviderSummary> {
    return provider(await this.#request(`/api/v1/providers/${encodeURIComponent(providerId)}`));
  }

  async packages(): Promise<readonly ProviderPackageSummary[]> {
    const input = record(await this.#request("/api/v1/provider-packages"));
    if (!Array.isArray(input.items)) throw invalidProjection();
    return input.items.map(providerPackage);
  }

  async resources(environment: string): Promise<Page<ResourceSummary>> {
    const input = await this.#request(
      `/api/v1/resources?environment=${encodeURIComponent(environment)}&limit=100`,
    );
    return page(input, resource);
  }

  async createProvider(input: CreateProviderInput): Promise<ProviderSummary> {
    const actorId = this.#actorId();
    if (actorId === undefined || actorId.trim().length === 0) {
      throw new PmsWebApiError(0, "PMS_WEB_ACTOR_REQUIRED");
    }
    return provider(
      await this.#request("/api/v1/providers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-id": actorId,
          "x-correlation-id": crypto.randomUUID(),
        },
        body: JSON.stringify(input),
      }),
    );
  }

  async #request(path: string, init: RequestInit = {}): Promise<unknown> {
    const authorization = this.#authorization();
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (authorization !== undefined) headers.set("authorization", authorization);
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      let code = "PMS_WEB_REQUEST_FAILED";
      try {
        const body = record(await response.json());
        const error = record(body.error);
        if (typeof error.code === "string") code = error.code;
      } catch {
        // The public error code remains stable when the response is not JSON.
      }
      throw new PmsWebApiError(response.status, code);
    }
    return response.json() as Promise<unknown>;
  }
}

function page<T>(value: unknown, project: (input: unknown) => T): Page<T> {
  const input = record(value);
  if (!Array.isArray(input.items)) throw invalidProjection();
  return {
    items: input.items.map(project),
    ...(typeof input.nextCursor === "string" ? { nextCursor: input.nextCursor } : {}),
  };
}

function provider(value: unknown): ProviderSummary {
  const input = record(value);
  const hostingMode = oneOf(input.hostingMode, ["vendor_managed", "platform_managed"]);
  const status = oneOf(input.status, ["draft", "active", "degraded", "disabled", "retired"]);
  return {
    providerId: text(input.providerId),
    providerTypeId: text(input.providerTypeId),
    ...(typeof input.packageId === "string" ? { packageId: input.packageId } : {}),
    ...(typeof input.packageVersion === "string" ? { packageVersion: input.packageVersion } : {}),
    hostingMode,
    status,
  };
}

function providerPackage(value: unknown): ProviderPackageSummary {
  const input = record(value);
  const qualification = record(input.qualification);
  if (!Array.isArray(input.hostingModes)) throw invalidProjection();
  return {
    packageId: text(input.packageId),
    packageVersion: text(input.packageVersion),
    providerType: text(input.providerType),
    hostingModes: input.hostingModes.map((mode) =>
      oneOf(mode, ["vendor_managed", "platform_managed"]),
    ),
    compatibleRuntimeVersion: text(input.compatibleRuntimeVersion),
    protocolMode: text(input.protocolMode),
    qualification: {
      componentStatus: oneOf(qualification.componentStatus, [
        "passed",
        "partial",
        "pending",
        "failed",
      ]),
      realResourceStatus: oneOf(qualification.realResourceStatus, [
        "qualified",
        "pending",
        "failed",
        "not_applicable",
      ]),
    },
  };
}

function resource(value: unknown): ResourceSummary {
  const input = record(value);
  return {
    environment: text(input.environment),
    resourceId: text(input.resourceId),
    resourceType: text(input.resourceType),
    status: oneOf(input.status, ["available", "unavailable", "retired"]),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidProjection();
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw invalidProjection();
  return value;
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) throw invalidProjection();
  return value;
}

function invalidProjection(): PmsWebApiError {
  return new PmsWebApiError(502, "PMS_WEB_RESPONSE_INVALID");
}
