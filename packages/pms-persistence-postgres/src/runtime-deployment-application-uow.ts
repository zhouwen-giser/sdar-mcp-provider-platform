import type { Pool, PoolClient } from "pg";
import type { RuntimeDeploymentApplicationRepositories, RuntimeDeploymentApplicationUnitOfWork } from "../../pms-application/src/index.js";
import { PostgresAuditRepository, PostgresJobLeaseRepository } from "./audit-job-repositories.js";
import { PostgresRuntimeDeploymentRepository } from "./runtime-deployment-repositories.js";
import type { PmsSqlClient } from "./shared.js";

export class PostgresRuntimeDeploymentApplicationUnitOfWork
  implements RuntimeDeploymentApplicationUnitOfWork
{
  constructor(private readonly pool: Pool) {}

  async transaction<T>(
    work: (repositories: RuntimeDeploymentApplicationRepositories) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const repositories = runtimeDeploymentApplicationRepositories(client);
      const result = await work(repositories);
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

export function runtimeDeploymentApplicationRepositories(
  client: PoolClient | PmsSqlClient,
): RuntimeDeploymentApplicationRepositories {
  return Object.freeze({
    deployments: new PostgresRuntimeDeploymentRepository(client),
    jobs: new PostgresJobLeaseRepository(client),
    audit: new PostgresAuditRepository(client),
  });
}
