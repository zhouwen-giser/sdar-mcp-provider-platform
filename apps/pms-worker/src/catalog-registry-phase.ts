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
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<DiscoveredCatalog>;
}

export interface CatalogRegistryEndpointPort {
  resolve(deployment: RuntimeDeploymentSnapshot): Promise<string>;
}

export interface CatalogRegistryProjectionPort {
  providers(input: {
    readonly deployment: RuntimeDeploymentSnapshot;
    readonly endpoint: string;
    readonly catalog: CatalogSnapshotPublication["snapshot"];
  }): Promise<readonly RegistryProviderInput[]>;
}

export interface CatalogRegistryStatePort {
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
  ) {}

  async close(
    deployment: RuntimeDeploymentSnapshot,
    context: RuntimeDeploymentReconcileInput["context"],
  ): Promise<CatalogRegistryPublicationResult> {
    if (deployment.status !== "DISCOVERING") {
      throw new Error("CATALOG_REGISTRY_PHASE_REQUIRES_DISCOVERING");
    }
    const expectedRevision = deployment.observedRevision;
    let endpoint: string;
    try {
      endpoint = await this.endpoints.resolve(deployment);
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
        endpoint,
        timeoutMs: context.timeoutMs,
        signal: context.signal,
      });
    } catch (error) {
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
      return this.#failed(deployment, expectedRevision, "CATALOG_COMMIT_FAILED", error);
    }
    let providers: readonly RegistryProviderInput[];
    try {
      providers = await this.projections.providers({
        deployment,
        endpoint,
        catalog: catalog.snapshot,
      });
    } catch (error) {
      return this.#failed(deployment, expectedRevision, "REGISTRY_PROJECTION_FAILED", error);
    }
    let registry: RegistrySnapshotPublication;
    try {
      registry = await this.registries.publish({
        candidate: buildRegistrySnapshot(deployment.environment, providers),
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
  async discover(input: {
    readonly endpoint: string;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<DiscoveredCatalog> {
    if (input.signal.aborted) throw new Error("CATALOG_DISCOVERY_ABORTED");
    return new CatalogDiscoveryClient(
      new HttpCatalogDiscoveryTransport({ endpoint: input.endpoint }),
      {
        timeoutMs: input.timeoutMs,
        maxAttempts: 3,
      },
    ).discover();
  }
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
