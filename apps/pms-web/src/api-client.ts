import type {
  CreateProviderInput,
  CreateConfigurationDraftInput,
  ConfigurationDraftSummary,
  EffectiveConfigurationSummary,
  Page,
  ProviderPackageSummary,
  ProviderSummary,
  ResourceSummary,
  RuntimeDeploymentSummary,
  RuntimeProcessSummary,
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

  async configurationDraft(draftId: string): Promise<ConfigurationDraftSummary> {
    return configurationDraft(
      await this.#request(`/api/v1/config-drafts/${encodeURIComponent(draftId)}`),
    );
  }

  async effectiveConfiguration(draftId: string): Promise<EffectiveConfigurationSummary> {
    return effectiveConfiguration(
      await this.#request(`/api/v1/config-drafts/${encodeURIComponent(draftId)}/effective`),
    );
  }

  async createConfigurationDraft(
    input: CreateConfigurationDraftInput,
  ): Promise<ConfigurationDraftSummary> {
    return configurationDraft(
      await this.#write("/api/v1/config-drafts", input, { method: "POST" }),
    );
  }

  async validateConfigurationDraft(draftId: string): Promise<ConfigurationDraftSummary> {
    return configurationDraft(
      await this.#write(
        `/api/v1/config-drafts/${encodeURIComponent(draftId)}/validate`,
        {},
        {
          method: "POST",
        },
      ),
    );
  }

  async publishConfigurationDraft(
    draftId: string,
    expectedDraftVersion: number,
    expectedPublishedRevision: number | null,
  ): Promise<void> {
    await this.#write(
      `/api/v1/config-drafts/${encodeURIComponent(draftId)}/publish`,
      { expectedDraftVersion, expectedPublishedRevision },
      { method: "POST" },
    );
  }

  async runtimeDeployments(providerId: string): Promise<Page<RuntimeDeploymentSummary>> {
    return page(
      await this.#request(
        `/api/v1/runtime-deployments?providerId=${encodeURIComponent(providerId)}&limit=100`,
      ),
      runtimeDeployment,
    );
  }

  async runtimeProcesses(
    providerId: string,
    deploymentId: string,
  ): Promise<Page<RuntimeProcessSummary>> {
    return page(
      await this.#request(
        `/api/v1/runtime-processes?providerId=${encodeURIComponent(providerId)}&deploymentId=${encodeURIComponent(deploymentId)}&limit=100`,
      ),
      runtimeProcess,
    );
  }

  async commandRuntime(
    deploymentId: string,
    action: "start" | "stop" | "restart",
    providerId: string,
    expectedDesiredRevision: number,
  ): Promise<RuntimeDeploymentSummary> {
    const response = record(
      await this.#write(
        `/api/v1/runtime-deployments/${encodeURIComponent(deploymentId)}/${action}`,
        { providerId, expectedDesiredRevision },
        { method: "POST" },
      ),
    );
    return runtimeDeployment(response.deployment);
  }

  async #write(path: string, body: unknown, init: RequestInit): Promise<unknown> {
    const actorId = this.#actorId();
    if (actorId === undefined || actorId.trim().length === 0) {
      throw new PmsWebApiError(0, "PMS_WEB_ACTOR_REQUIRED");
    }
    return this.#request(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-actor-id": actorId,
        "x-correlation-id": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
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

function configurationDraft(value: unknown): ConfigurationDraftSummary {
  const input = record(value);
  const key = record(input.key);
  const content = record(input.content);
  if (!Array.isArray(input.validationIssues)) throw invalidProjection();
  const secretConfiguredKeys = Object.entries(content)
    .filter(([, candidate]) => isSecretRef(candidate))
    .map(([name]) => name);
  return {
    draftId: text(input.draftId),
    definitionId: text(input.definitionId),
    environment: text(key.environment),
    targetType: text(key.targetType),
    targetId: text(key.targetId),
    configGroup: text(key.configGroup),
    dataId: text(key.dataId),
    version: integer(input.version),
    status: oneOf(input.status, ["draft", "validated", "invalid"]),
    ...(input.applyMode === undefined
      ? {}
      : {
          applyMode: oneOf(input.applyMode, [
            "hot_reload",
            "reconnect_required",
            "restart_required",
            "immutable",
          ]),
        }),
    configuredKeys: Object.keys(content),
    secretConfiguredKeys,
    validationIssues: input.validationIssues.map((issue) => {
      const item = record(issue);
      return { code: text(item.code), path: text(item.path) };
    }),
  };
}

function effectiveConfiguration(value: unknown): EffectiveConfigurationSummary {
  const input = record(value);
  const content = record(input.content);
  const sources = record(input.sources);
  return {
    applyMode: oneOf(input.applyMode, [
      "hot_reload",
      "reconnect_required",
      "restart_required",
      "immutable",
    ]),
    valid: boolean(input.valid),
    keys: Object.keys(content),
    sources: Object.fromEntries(
      Object.entries(sources).map(([key, source]) => [key, text(source)]),
    ),
  };
}

function runtimeDeployment(value: unknown): RuntimeDeploymentSummary {
  const input = record(value);
  return {
    deploymentId: text(input.deploymentId),
    providerId: text(input.providerId),
    environment: text(input.environment),
    desiredState: oneOf(input.desiredState, ["running", "stopped"]),
    desiredReplicas: integer(input.desiredReplicas),
    runtimeVersion: text(input.runtimeVersion),
    status: text(input.status),
    desiredRevision: integer(input.desiredRevision),
    observedRevision: integer(input.observedRevision),
  };
}

function runtimeProcess(value: unknown): RuntimeProcessSummary {
  const input = record(value);
  return {
    instanceId: text(input.instanceId),
    deploymentId: text(input.deploymentId),
    processState: oneOf(input.processState, [
      "missing",
      "starting",
      "online",
      "stopping",
      "stopped",
      "errored",
    ]),
    livenessState: oneOf(input.livenessState, ["unknown", "live", "dead"]),
    readinessState: oneOf(input.readinessState, ["unknown", "ready", "not_ready"]),
    observedHealth: text(input.observedHealth),
    readyForActive: boolean(input.readyForActive),
    healthReasonCode: text(input.healthReasonCode),
    configState: oneOf(input.configState, [
      "unknown",
      "current",
      "stale",
      "rejected",
      "restart_required",
    ]),
    configRevision: input.configRevision === null ? null : integer(input.configRevision),
    runtimeVersion: input.runtimeVersion === null ? null : text(input.runtimeVersion),
    restartCount: integer(input.restartCount),
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

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidProjection();
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalidProjection();
  return value;
}

function isSecretRef(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.secretRef === "string";
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
