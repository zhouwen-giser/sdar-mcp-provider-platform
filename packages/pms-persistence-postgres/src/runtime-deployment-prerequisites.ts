import type { Pool } from "pg";
import type {
  RuntimeDeploymentDatabaseProfilePrerequisite,
  RuntimeDeploymentPrerequisitePort,
} from "../../pms-application/src/index.js";
import {
  parseRuntimeConfigProfileLocator,
  toConfigurationTarget,
} from "../../pms-application/src/index.js";
import { secretRef } from "../../pms-domain/src/index.js";
import type { ProviderStatus } from "../../pms-domain/src/index.js";
import { PostgresProviderRepository } from "./catalog-repositories.js";
import { PostgresConfigurationRepository } from "./configuration-repository.js";

const DEPLOYABLE_PROVIDER_STATUSES: readonly ProviderStatus[] = ["active", "degraded"];

export class PostgresRuntimeDeploymentPrerequisites implements RuntimeDeploymentPrerequisitePort {
  constructor(private readonly pool: Pool) {}

  async providerAvailable(providerId: string): Promise<boolean> {
    const repo = new PostgresProviderRepository(this.pool);
    const provider = await repo.get(providerId as Parameters<typeof repo.get>[0]);
    if (provider === null) return false;
    return DEPLOYABLE_PROVIDER_STATUSES.includes(provider.status);
  }

  async configProfileAvailable(configProfileId: string): Promise<boolean> {
    let locator;
    try {
      locator = parseRuntimeConfigProfileLocator(configProfileId);
    } catch {
      return false;
    }
    const target = toConfigurationTarget(locator);
    const repo = new PostgresConfigurationRepository(this.pool);
    const revision = await repo.getPublishedRevision(target);
    return revision !== null;
  }

  async databaseProfileAvailable(
    input: RuntimeDeploymentDatabaseProfilePrerequisite,
  ): Promise<boolean> {
    const result = await this.pool.query<{
      provision_status: string;
      admin_secret_ref: string | null;
      runtime_secret_ref: string | null;
    }>(
      `SELECT provision_status,admin_secret_ref,runtime_secret_ref
         FROM database_profile
        WHERE profile_id=$1 AND provider_id=$2 AND environment=$3`,
      [input.databaseProfileId, input.providerId, input.environment],
    );
    const row = result.rows[0];
    if (row === undefined) return false;
    if (row.provision_status !== "ready") return false;
    const adminSecretRef = row.admin_secret_ref;
    const runtimeSecretRef = row.runtime_secret_ref;
    if (adminSecretRef === null || runtimeSecretRef === null) return false;
    try {
      secretRef(adminSecretRef);
      secretRef(runtimeSecretRef);
    } catch {
      return false;
    }
    if (adminSecretRef === runtimeSecretRef) return false;
    if (adminSecretRef.trim().length === 0 || runtimeSecretRef.trim().length === 0) {
      return false;
    }
    return true;
  }
}
