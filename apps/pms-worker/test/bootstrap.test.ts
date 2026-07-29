import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { PmsWorkerProductionComposition } from "../src/composition.js";
import type { PmsWorkerConfig } from "../src/config.js";
import { bootstrapPmsWorker } from "../src/bootstrap.js";
import type { PmsWorker } from "../src/worker.js";

describe("PMS Worker production bootstrap", () => {
  it("starts after migrations and closes composition before the PMS Pool", async () => {
    const events: string[] = [];
    const pool = {
      end: vi.fn(() => {
        events.push("pool.close");
        return Promise.resolve();
      }),
    } as unknown as Pool;
    const worker = {} as PmsWorker;
    const composition = {
      worker,
      start: () => {
        events.push("composition.start");
      },
      close: () => {
        events.push("composition.close");
        return Promise.resolve();
      },
    } as unknown as PmsWorkerProductionComposition;

    const running = await bootstrapPmsWorker({
      loadConfig: () => Promise.resolve(config()),
      readDatabaseUrl: () => Promise.resolve("postgresql://redacted"),
      createPool: () => pool,
      runMigrations: () => {
        events.push("migrations");
        return Promise.resolve();
      },
      createComposition: () => {
        events.push("composition.create");
        return Promise.resolve(composition);
      },
    });

    expect(running.worker).toBe(worker);
    expect(events).toEqual(["migrations", "composition.create", "composition.start"]);
    await running.stop();
    await running.stop();
    expect(events).toEqual([
      "migrations",
      "composition.create",
      "composition.start",
      "composition.close",
      "pool.close",
    ]);
  });

  it("closes partially constructed resources when startup fails", async () => {
    const events: string[] = [];
    const pool = {
      end: vi.fn(() => {
        events.push("pool.close");
        return Promise.resolve();
      }),
    } as unknown as Pool;
    const composition = {
      worker: {} as PmsWorker,
      start: () => {
        throw new Error("START_FAILED");
      },
      close: () => {
        events.push("composition.close");
        return Promise.resolve();
      },
    } as unknown as PmsWorkerProductionComposition;

    await expect(
      bootstrapPmsWorker({
        loadConfig: () => Promise.resolve(config()),
        readDatabaseUrl: () => Promise.resolve("postgresql://redacted"),
        createPool: () => pool,
        runMigrations: () => Promise.resolve(),
        createComposition: () => Promise.resolve(composition),
      }),
    ).rejects.toThrow("START_FAILED");
    expect(events).toEqual(["composition.close", "pool.close"]);
  });
});

function config(): PmsWorkerConfig {
  return Object.freeze({
    databaseUrlFile: "/run/secrets/pms-database-url",
    workerId: "bootstrap-test",
    pollIntervalMs: 1_000,
    leaseDurationMs: 5_000,
    claimLimit: 1,
    retryDelayMs: 1_000,
    workspaceRoot: process.cwd(),
  });
}
