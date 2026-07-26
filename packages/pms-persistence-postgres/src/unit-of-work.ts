import type { Pool, PoolClient } from "pg";
import type { PmsRepositories, PmsUnitOfWork } from "../../pms-domain/src/index.js";
import { PostgresAuditRepository, PostgresJobLeaseRepository } from "./audit-job-repositories.js";
import {
  PostgresProviderPackageRepository,
  PostgresProviderRepository,
  PostgresProviderResourceBindingRepository,
  PostgresProviderTypeRepository,
  PostgresResourceRepository,
} from "./catalog-repositories.js";
import { PostgresConfigurationRepository } from "./configuration-repository.js";

export function postgresRepositories(client: Pool | PoolClient): PmsRepositories {
  return Object.freeze({
    providerTypes: new PostgresProviderTypeRepository(client),
    providerPackages: new PostgresProviderPackageRepository(client),
    providers: new PostgresProviderRepository(client),
    resources: new PostgresResourceRepository(client),
    providerResourceBindings: new PostgresProviderResourceBindingRepository(client),
    configuration: new PostgresConfigurationRepository(client),
    audit: new PostgresAuditRepository(client),
    jobs: new PostgresJobLeaseRepository(client),
  });
}

export class PostgresPmsUnitOfWork implements PmsUnitOfWork {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(work: (repositories: PmsRepositories) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(postgresRepositories(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
