import { Pool } from "pg";
import {
  PostgresPmsUnitOfWork,
  postgresRepositories,
  runPmsMigrations,
} from "../../../packages/pms-persistence-postgres/src/index.js";
import { loadPmsWorkerConfig, readDatabaseUrlFile } from "./config.js";
import { PmsJobRegistry } from "./job-registry.js";
import { createPackageSyncJobHandler } from "./package-sync-job.js";
import { PmsWorker } from "./worker.js";

export interface RunningPmsWorker {
  readonly worker: PmsWorker;
  stop(): Promise<void>;
}

export async function bootstrapPmsWorker(): Promise<RunningPmsWorker> {
  const config = await loadPmsWorkerConfig();
  const pool = new Pool({ connectionString: await readDatabaseUrlFile(config.databaseUrlFile) });
  try {
    await runPmsMigrations(pool, config.workspaceRoot);
    const unitOfWork = new PostgresPmsUnitOfWork(pool);
    const registry = new PmsJobRegistry([
      createPackageSyncJobHandler({ unitOfWork, workspaceRoot: config.workspaceRoot }),
    ]);
    const worker = new PmsWorker(config, postgresRepositories(pool).jobs, registry);
    worker.start();
    return {
      worker,
      async stop(): Promise<void> {
        await worker.stop();
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
