import { PmsDomainError, PmsRepositoryError } from "../../pms-domain/src/index.js";
import {
  loadProviderPackageRegistry,
  type ComponentQualificationStatus,
  type ProviderHostingMode,
  type ProviderPackage,
  type ProviderPackageRegistry,
  type RealResourceQualificationStatus,
} from "../../provider-package-registry/src/index.js";

export interface ProviderPackageListFilter {
  readonly providerType?: string;
  readonly hostingMode?: ProviderHostingMode;
  readonly componentStatus?: ComponentQualificationStatus;
  readonly realResourceStatus?: RealResourceQualificationStatus;
}

export interface PublicProviderPackage {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly providerType: string;
  readonly hostingModes: readonly ProviderHostingMode[];
  readonly configSchemaId: string;
  readonly compatibleRuntimeVersion: string;
  readonly protocolMode: string;
  readonly qualification: {
    readonly componentStatus: ComponentQualificationStatus;
    readonly realResourceStatus: RealResourceQualificationStatus;
  };
}

export class ProviderPackageQueryService {
  constructor(private readonly registry: ProviderPackageRegistry) {}

  list(filter: ProviderPackageListFilter = {}): readonly PublicProviderPackage[] {
    return this.registry
      .list()
      .filter((providerPackage) => matches(providerPackage, filter))
      .map(publicProjection);
  }

  get(packageId: string, packageVersion?: string): PublicProviderPackage {
    requireIdentifier(packageId, "packageId");
    if (packageVersion !== undefined) requireIdentifier(packageVersion, "packageVersion");
    const matches = this.registry
      .list()
      .filter(
        (providerPackage) =>
          providerPackage.packageId === packageId &&
          (packageVersion === undefined || providerPackage.packageVersion === packageVersion),
      );
    if (matches.length === 0) {
      throw new PmsRepositoryError("ENTITY_NOT_FOUND", "Provider Package does not exist", {
        aggregate: "ProviderPackage",
      });
    }
    if (matches.length > 1) {
      throw new PmsDomainError("INVALID_DOMAIN_VALUE", "Provider Package version is required", {
        field: "packageVersion",
      });
    }
    const providerPackage = matches[0];
    if (providerPackage === undefined) throw new Error("PROVIDER_PACKAGE_QUERY_INVARIANT");
    return publicProjection(providerPackage);
  }
}

export async function loadProviderPackageQueryService(
  workspaceRoot = process.cwd(),
): Promise<ProviderPackageQueryService> {
  return new ProviderPackageQueryService(await loadProviderPackageRegistry(workspaceRoot));
}

function matches(providerPackage: ProviderPackage, filter: ProviderPackageListFilter): boolean {
  return (
    (filter.providerType === undefined || providerPackage.providerType === filter.providerType) &&
    (filter.hostingMode === undefined ||
      providerPackage.hostingModes.includes(filter.hostingMode)) &&
    (filter.componentStatus === undefined ||
      providerPackage.qualification.componentStatus === filter.componentStatus) &&
    (filter.realResourceStatus === undefined ||
      providerPackage.qualification.realResourceStatus === filter.realResourceStatus)
  );
}

function publicProjection(providerPackage: ProviderPackage): PublicProviderPackage {
  return Object.freeze({
    packageId: providerPackage.packageId,
    packageVersion: providerPackage.packageVersion,
    providerType: providerPackage.providerType,
    hostingModes: Object.freeze([...providerPackage.hostingModes]),
    configSchemaId: providerPackage.adapter.configSchemaId,
    compatibleRuntimeVersion: providerPackage.runtime.compatibleRuntimeVersion,
    protocolMode: providerPackage.runtime.protocolMode,
    qualification: Object.freeze({
      componentStatus: providerPackage.qualification.componentStatus,
      realResourceStatus: providerPackage.qualification.realResourceStatus,
    }),
  });
}

function requireIdentifier(value: string, field: string): void {
  if (value.length === 0 || value.length > 128 || containsControlCharacter(value)) {
    throw new PmsDomainError("INVALID_DOMAIN_VALUE", "Invalid Provider Package query", { field });
  }
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
