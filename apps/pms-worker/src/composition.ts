import type { Pool } from "pg";
import { PostgresPmsUnitOfWork, postgresRepositories } from "@sdar/pms-persistence-postgres";
import type { PmsWorkerConfig } from "./config.js";
import { PmsJobRegistry } from "./job-registry.js";
import { createPackageSyncJobHandler } from "./package-sync-job.js";
import { createProductionRuntimeComposition } from "./runtime-composition.js";
import { createRuntimeDeploymentReconcileJobHandler } from "./runtime-reconcile-job.js";
import { PmsWorker } from "./worker.js";

export interface PmsWorkerProductionComposition {
  readonly worker: PmsWorker;
  readonly registry: PmsJobRegistry;
  readonly runtime: Awaited<ReturnType<typeof createProductionRuntimeComposition>>;
  start(): void;
  close(): Promise<void>;
}

export async function createPmsWorkerProductionComposition(
  pool: Pool,
  config: PmsWorkerConfig,
): Promise<PmsWorkerProductionComposition> {
  const runtime = await createProductionRuntimeComposition(pool, config);
  try {
    const registry = new PmsJobRegistry([
      createPackageSyncJobHandler({
        unitOfWork: new PostgresPmsUnitOfWork(pool),
        workspaceRoot: config.workspaceRoot,
      }),
      createRuntimeDeploymentReconcileJobHandler(
        runtime.reconciler,
        config.runtime?.runtimeReconcileTimeoutMs,
      ),
    ]);
    const worker = new PmsWorker(config, postgresRepositories(pool).jobs, registry);
    let started = false;
    let closed = false;
    return Object.freeze({
      worker,
      registry,
      runtime,
      start(): void {
        if (started) return;
        runtime.scheduler.start();
        try {
          worker.start();
          started = true;
        } catch (error) {
          void runtime.scheduler.stop();
          throw error;
        }
      },
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        let failure: unknown;
        try {
          await runtime.scheduler.stop();
        } catch (error) {
          failure = error;
        }
        try {
          await boundedWorkerStop(worker, config.leaseDurationMs);
        } catch (error) {
          failure ??= error;
        }
        try {
          await runtime.close();
        } catch (error) {
          failure ??= error;
        }
        if (failure !== undefined) {
          throw failure instanceof Error
            ? failure
            : new Error("PMS_WORKER_SHUTDOWN_FAILED", { cause: failure });
        }
      },
    });
  } catch (error) {
    await runtime.close().catch(() => undefined);
    throw error;
  }
}

async function boundedWorkerStop(worker: PmsWorker, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      worker.stop(),
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("PMS_WORKER_SHUTDOWN_TIMEOUT")), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
