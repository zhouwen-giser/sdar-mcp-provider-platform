import type {
  CatalogSnapshotPublication,
  CatalogSnapshotRepository,
  DiscoveredCatalog,
} from "../../../packages/catalog-manager/src/index.js";
import {
  CatalogDiscoveryClient,
  HttpCatalogDiscoveryTransport,
} from "../../../packages/catalog-manager/src/index.js";
import type {
  RuntimeDeploymentReconcileInput,
  RuntimeDeploymentReconcileResult,
} from "../../../packages/pms-application/src/index.js";
import type { RuntimeDeploymentSnapshot } from "../../../packages/runtime-deployment/src/index.js";
import {
  buildRegistrySnapshot,
  type RegistryProviderInput,
  type RegistrySnapshotPublication,
  type RegistrySnapshotRepository,
} from "../../../packages/registry-snapshot/src/index.js";

export interface CatalogRegistryDiscoveryPort {
  discover(input: {
    readonly endpoint: string;
    readonly authorization?: string;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<DiscoveredCatalog>;
}

export interface CatalogRegistryEndpointPort {
  resolve(deployment: RuntimeDeploymentSnapshot): Promise<{
    readonly endpoint: string;
    readonly authorization?: string;
  }>;
}

export interface CatalogRegistryProjectionPort {
  providers(input: {
    readonly deployment: RuntimeDeploymentSnapshot;
    readonly catalog: CatalogSnapshotPublication["snapshot"];
  }): Promise<readonly RegistryProviderInput[]>;
}

export interface CatalogRegistryStatePort {
  recordCatalogState(
    deployment: RuntimeDeploymentSnapshot,
    state: "pending" | "valid" | "invalid",
  ): Promise<void>;
  activate(
    deployment: RuntimeDeploymentSnapshot,
    expectedObservedRevision: number,
  ): Promise<RuntimeDeploymentSnapshot>;
  fail(
    deployment: RuntimeDeploymentSnapshot,
    expectedObservedRevision: number,
    reasonCode: CatalogRegistryFailureCode,
  ): Promise<RuntimeDeploymentSnapshot>;
}

export type CatalogRegistryFailureCode =
  | "CATALOG_ENDPOINT_RESOLUTION_FAILED"
  | "CATALOG_DISCOVERY_FAILED"
  | "CATALOG_COMMIT_FAILED"
  | "CATALOG_STATE_COMMIT_FAILED"
  | "REGISTRY_PROJECTION_FAILED"
  | "REGISTRY_COMMIT_FAILED";

export interface CatalogRegistryPublicationResult {
  readonly deployment: RuntimeDeploymentSnapshot;
  readonly catalog: CatalogSnapshotPublication;
  readonly registry: RegistrySnapshotPublication;
}

export class CatalogRegistryPublicationPhase {
  constructor(
    private readonly discovery: CatalogRegistryDiscoveryPort,
    private readonly endpoints: CatalogRegistryEndpointPort,
    private readonly catalogs: CatalogSnapshotRepository,
    private readonly projections: CatalogRegistryProjectionPort,
    private readonly registries: RegistrySnapshotRepository,
    private readonly state: CatalogRegistryStatePort,
    private readonly options: { readonly allowInsecureInternalTransport?: boolean } = {},
  ) {}

  async close(
    deployment: RuntimeDeploymentSnapshot,
    context: RuntimeDeploymentReconcileInput["context"],
  ): Promise<CatalogRegistryPublicationResult> {
    if (deployment.status !== "DISCOVERING") {
      throw new Error("CATALOG_REGISTRY_PHASE_REQUIRES_DISCOVERING");
    }
    const expectedRevision = deployment.observedRevision;
    try {
      await this.state.recordCatalogState(deployment, "pending");
    } catch (error) {
      return this.#failed(deployment, expectedRevision, "CATALOG_STATE_COMMIT_FAILED", error);
    }
    let target: Awaited<ReturnType<CatalogRegistryEndpointPort["resolve"]>>;
    try {
      target = await this.endpoints.resolve(deployment);
    } catch (error) {
      return this.#failed(
        deployment,
        expectedRevision,
        "CATALOG_ENDPOINT_RESOLUTION_FAILED",
        error,
      );
    }
    let discovered: DiscoveredCatalog;
    try {
      discovered = await this.discovery.discover({
        endpoint: target.endpoint,
        ...(target.authorization === undefined ? {} : { authorization: target.authorization }),
        timeoutMs: context.timeoutMs,
        signal: context.signal,
      });
    } catch (error) {
      await this.#recordInvalidCatalog(deployment);
      return this.#failed(deployment, expectedRevision, "CATALOG_DISCOVERY_FAILED", error);
    }
    let catalog: CatalogSnapshotPublication;
    try {
      catalog = await this.catalogs.publish({
        providerId: deployment.providerId,
        catalog: discovered,
        actorId: "pms-worker",
        correlationId: context.correlationId,
        discoveredAt: new Date(),
      });
    } catch (error) {
      await this.#recordInvalidCatalog(deployment);
      return this.#failed(deployment, expectedRevision, "CATALOG_COMMIT_FAILED", error);
    }
    try {
      await this.state.recordCatalogState(deployment, "valid");
    } catch (error) {
      return this.#failed(deployment, expectedRevision, "CATALOG_STATE_COMMIT_FAILED", error);
    }
    let providers: readonly RegistryProviderInput[];
    try {
      providers = await this.projections.providers({
        deployment,
        catalog: catalog.snapshot,
      });
    } catch (error) {
      return this.#failed(deployment, expectedRevision, "REGISTRY_PROJECTION_FAILED", error);
    }
    let registry: RegistrySnapshotPublication;
    try {
      registry = await this.registries.publish({
        candidate: buildRegistrySnapshot(deployment.environment, providers, this.options),
        actorId: "pms-worker",
        correlationId: context.correlationId,
        publishedAt: new Date(),
      });
    } catch (error) {
      return this.#failed(deployment, expectedRevision, "REGISTRY_COMMIT_FAILED", error);
    }
    const active = await this.state.activate(deployment, expectedRevision);
    return { deployment: active, catalog, registry };
  }

  async #failed(
    deployment: RuntimeDeploymentSnapshot,
    expectedRevision: number,
    reasonCode: CatalogRegistryFailureCode,
    cause: unknown,
  ): Promise<never> {
    await this.state.fail(deployment, expectedRevision, reasonCode);
    throw new CatalogRegistryPublicationError(reasonCode, { cause });
  }

  async #recordInvalidCatalog(deployment: RuntimeDeploymentSnapshot): Promise<void> {
    try {
      await this.state.recordCatalogState(deployment, "invalid");
    } catch {
      // Preserve the primary discovery/commit failure classification.
    }
  }
}

export class CatalogRegistryPublicationError extends Error {
  constructor(
    readonly code: CatalogRegistryFailureCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "CatalogRegistryPublicationError";
  }
}

export class HttpCatalogRegistryDiscovery implements CatalogRegistryDiscoveryPort {
  constructor(
    private readonly options: {
      readonly allowInsecureInternalTransport?: boolean;
      readonly fetch?: typeof globalThis.fetch;
    } = {},
  ) {}

  async discover(input: {
    readonly endpoint: string;
    readonly authorization?: string;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<DiscoveredCatalog> {
    if (input.signal.aborted) throw new Error("CATALOG_DISCOVERY_ABORTED");
    const endpoint = validatedCatalogEndpoint(
      input.endpoint,
      this.options.allowInsecureInternalTransport === true,
    );
    return new CatalogDiscoveryClient(
      new HttpCatalogDiscoveryTransport({
        endpoint,
        ...(input.authorization === undefined ? {} : { authorization: input.authorization }),
        ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
      }),
      {
        timeoutMs: input.timeoutMs,
        maxAttempts: 3,
      },
    ).discover();
  }
}

function validatedCatalogEndpoint(source: string, allowInsecureInternalTransport: boolean): string {
  let endpoint: URL;
  try {
    endpoint = new URL(source);
  } catch (error) {
    throw new Error("CATALOG_ENDPOINT_INVALID", { cause: error });
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== "https:" &&
      !(endpoint.protocol === "http:" && (loopback || allowInsecureInternalTransport))) ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new Error("CATALOG_ENDPOINT_INVALID");
  }
  return endpoint.toString();
}

export class CatalogRegistryReconcileDecorator {
  constructor(
    private readonly reconciler: {
      reconcile(input: RuntimeDeploymentReconcileInput): Promise<RuntimeDeploymentReconcileResult>;
    },
    private readonly phase: CatalogRegistryPublicationPhase,
  ) {}

  async reconcile(
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeDeploymentReconcileResult> {
    const result = await this.reconciler.reconcile(input);
    if (result.deployment.status !== "DISCOVERING") return result;
    const publication = await this.phase.close(result.deployment, input.context);
    return {
      ...result,
      deployment: publication.deployment,
      progressed: true,
    };
  }
}
