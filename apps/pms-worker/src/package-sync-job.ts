import type { JobLease, PmsUnitOfWork } from "../../../packages/pms-domain/src/index.js";
import { synchronizeWorkspaceProviderPackages } from "../../../packages/pms-application/src/index.js";
import type { PmsJobHandler } from "./job-registry.js";

export const PROVIDER_PACKAGE_SYNC_JOB = "provider_package.sync";

export interface PackageSyncJobOptions {
  readonly unitOfWork: PmsUnitOfWork;
  readonly workspaceRoot: string;
  readonly synchronize?: typeof synchronizeWorkspaceProviderPackages;
}

export function createPackageSyncJobHandler(options: PackageSyncJobOptions): PmsJobHandler {
  const synchronize = options.synchronize ?? synchronizeWorkspaceProviderPackages;
  return {
    jobType: PROVIDER_PACKAGE_SYNC_JOB,
    async execute(lease: JobLease): Promise<void> {
      await synchronize(
        options.unitOfWork,
        {
          actorId: `worker:${lease.owner}`,
          correlationId: `job:${lease.job.jobId}:fence:${String(lease.fencingToken)}`,
        },
        options.workspaceRoot,
      );
    },
  };
}
