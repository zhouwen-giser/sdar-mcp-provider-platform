import type { CatalogSnapshot } from "../../../packages/catalog-manager/src/index.js";
import type { RegistryProviderInput } from "../../../packages/registry-snapshot/src/index.js";
import type {
  RuntimeDeployment,
  RuntimeDeploymentSnapshot,
} from "../../../packages/runtime-deployment/src/index.js";

export interface RegistryProviderProjectionInput {
  readonly deployment: RuntimeDeploymentSnapshot;
  readonly endpoint: string;
  readonly catalog: CatalogSnapshot;
  readonly deployments: readonly RuntimeDeployment[];
  readonly activeCatalog: (providerId: string) => Promise<CatalogSnapshot | null>;
  readonly ensureInstance: (
    deployment: RuntimeDeploymentSnapshot,
  ) => Promise<{ readonly instanceId: string }>;
  readonly runtimeBaseUrl: (deployment: RuntimeDeploymentSnapshot) => Promise<string>;
}

export async function buildRegistryProviderProjection(
  input: RegistryProviderProjectionInput,
): Promise<readonly RegistryProviderInput[]> {
  const providers: RegistryProviderInput[] = [];
  for (const candidate of input.deployments) {
    const snapshot = candidate.snapshot;
    if (
      snapshot.environment !== input.deployment.environment ||
      snapshot.desiredState !== "running" ||
      !["ACTIVE", "DISCOVERING"].includes(snapshot.status)
    ) {
      continue;
    }
    const isCurrent = snapshot.deploymentId === input.deployment.deploymentId;
    const catalog = isCurrent
      ? input.catalog
      : await input.activeCatalog(String(snapshot.providerId));
    if (catalog === null) throw new Error("REGISTRY_ACTIVE_CATALOG_MISSING");
    const instance = await input.ensureInstance(snapshot);
    const endpoint = isCurrent ? input.endpoint : `${await input.runtimeBaseUrl(snapshot)}/mcp`;
    providers.push({
      providerId: String(snapshot.providerId),
      serverId: instance.instanceId,
      protocolMode: "frozen_v1",
      effectiveEndpoint: endpoint.replace(/\/mcp$/, ""),
      catalog,
    });
  }
  return Object.freeze(providers);
}
