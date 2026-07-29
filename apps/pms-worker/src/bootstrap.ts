import { Pool } from "pg";
import { runPmsMigrations } from "@sdar/pms-persistence-postgres";
import {
  createPmsWorkerProductionComposition,
  type PmsWorkerProductionComposition,
} from "./composition.js";
import { loadPmsWorkerConfig, readDatabaseUrlFile } from "./config.js";
import type { PmsWorkerConfig } from "./config.js";
import type { PmsWorker } from "./worker.js";

export interface RunningPmsWorker {
  readonly worker: PmsWorker;
  stop(): Promise<void>;
}

export interface PmsWorkerBootstrapDependencies {
  readonly loadConfig?: () => Promise<PmsWorkerConfig>;
  readonly readDatabaseUrl?: (path: string) => Promise<string>;
  readonly createPool?: (connectionString: string) => Pool;
  readonly runMigrations?: (pool: Pool, workspaceRoot: string) => Promise<unknown>;
  readonly createComposition?: (
    pool: Pool,
    config: PmsWorkerConfig,
  ) => Promise<PmsWorkerProductionComposition>;
}

export async function bootstrapPmsWorker(
  dependencies: PmsWorkerBootstrapDependencies = {},
): Promise<RunningPmsWorker> {
  const config = await (dependencies.loadConfig ?? loadPmsWorkerConfig)();
  const connectionString = await (dependencies.readDatabaseUrl ?? readDatabaseUrlFile)(
    config.databaseUrlFile,
  );
  const pool = dependencies.createPool?.(connectionString) ?? new Pool({ connectionString });
  let composition: PmsWorkerProductionComposition | undefined;
  try {
    await (dependencies.runMigrations ?? runPmsMigrations)(pool, config.workspaceRoot);
    composition = await (dependencies.createComposition ?? createPmsWorkerProductionComposition)(
      pool,
      config,
    );
    composition.start();
    let stopped = false;
    return {
      worker: composition.worker,
      async stop(): Promise<void> {
        if (stopped) return;
        stopped = true;
        try {
          await composition?.close();
        } finally {
          await pool.end();
        }
      },
    };
  } catch (error) {
    await composition?.close().catch(() => undefined);
    await pool.end();
    throw error;
  }
}
