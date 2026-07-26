import type { AuditRepository } from "./audit.js";
import type { JobLeaseRepository } from "./job-lease.js";
import type {
  ConfigurationRepository,
  ProviderPackageRepository,
  ProviderRepository,
  ProviderResourceBindingRepository,
  ProviderTypeRepository,
  ResourceRepository,
} from "./repositories.js";

export interface PmsRepositories {
  readonly providerTypes: ProviderTypeRepository;
  readonly providerPackages: ProviderPackageRepository;
  readonly providers: ProviderRepository;
  readonly resources: ResourceRepository;
  readonly providerResourceBindings: ProviderResourceBindingRepository;
  readonly configuration: ConfigurationRepository;
  readonly audit: AuditRepository;
  readonly jobs: JobLeaseRepository;
}

export interface PmsUnitOfWork {
  /**
   * Commits only after work resolves and rolls back when it rejects. Repositories supplied to the
   * callback share one transaction and must not be retained after the callback settles.
   */
  transaction<T>(work: (repositories: PmsRepositories) => Promise<T>): Promise<T>;
}
