import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  JobLease,
  JobLeaseRepository,
  PmsUnitOfWork,
} from "../../../packages/pms-domain/src/index.js";
import {
  createPackageSyncJobHandler,
  loadPmsWorkerConfig,
  PmsJobRegistry,
  PmsWorker,
  PROVIDER_PACKAGE_SYNC_JOB,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("PMS Worker foundation", () => {
  it("loads the database URL only through an absolute secret file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pms-worker-config-"));
    temporaryDirectories.push(directory);
    const secretFile = join(directory, "database-url");
    await writeFile(secretFile, "postgresql://local-only\n", { mode: 0o600 });

    const config = await loadPmsWorkerConfig({
      PMS_DATABASE_URL_FILE: secretFile,
      PMS_WORKER_ID: "worker-1",
      PMS_WORKER_POLL_INTERVAL_MS: "25",
      PMS_WORKSPACE_ROOT: "/workspace",
    });

    expect(config).toMatchObject({
      databaseUrlFile: secretFile,
      workerId: "worker-1",
      pollIntervalMs: 25,
      workspaceRoot: "/workspace",
    });
    await expect(
      loadPmsWorkerConfig({
        PMS_DATABASE_URL_FILE: secretFile,
        PMS_DATABASE_URL: "postgresql://inline",
      }),
    ).rejects.toThrow("PMS_WORKER_INLINE_DATABASE_SECRET_REJECTED");
  });

  it("rejects duplicate handlers and exposes a stable sorted allowlist", () => {
    const handler = { jobType: "provider_package.sync", execute: vi.fn() };
    const registry = new PmsJobRegistry([handler]);

    expect(registry.jobTypes()).toEqual(["provider_package.sync"]);
    expect(() => registry.register(handler)).toThrow("PMS_JOB_HANDLER_DUPLICATE");
  });

  it("claims a registered job, executes it, and acknowledges completion", async () => {
    const lease = jobLease("provider_package.sync");
    const execute = vi.fn(() => Promise.resolve());
    const { repository, complete, fail } = fakeJobs([lease]);
    const worker = new PmsWorker(
      workerConfig(),
      repository,
      new PmsJobRegistry([{ jobType: lease.job.jobType, execute }]),
    );

    expect(await worker.runOnce()).toBe(1);
    expect(execute).toHaveBeenCalledWith(lease);
    expect(complete).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
    expect(worker.health.snapshot().lastSuccessfulLoopAt).toBeInstanceOf(Date);
  });

  it("starts and drains safely when shutdown interrupts the polling delay", async () => {
    const { repository } = fakeJobs([]);
    const worker = new PmsWorker(
      workerConfig({ pollIntervalMs: 60_000 }),
      repository,
      new PmsJobRegistry([{ jobType: "noop", execute: vi.fn() }]),
    );

    worker.start();
    expect(worker.health.snapshot()).toMatchObject({ state: "ready", ready: true });
    await worker.stop();
    expect(worker.health.snapshot()).toMatchObject({ state: "stopped", ready: false });
  });

  it("runs the controlled Provider Package sync handler with job audit identity", async () => {
    const synchronize = vi.fn(() => Promise.resolve({ inserted: 3, updated: 0, unchanged: 0 }));
    const unitOfWork = { transaction: vi.fn() } as unknown as PmsUnitOfWork;
    const handler = createPackageSyncJobHandler({
      unitOfWork,
      workspaceRoot: "/workspace",
      synchronize,
    });
    const lease = jobLease(PROVIDER_PACKAGE_SYNC_JOB);

    await handler.execute(lease);

    expect(synchronize).toHaveBeenCalledWith(
      unitOfWork,
      {
        actorId: "worker:worker-1",
        correlationId: "job:job-1:fence:1",
      },
      "/workspace",
    );
  });
});

function fakeJobs(leases: readonly JobLease[]) {
  const complete = vi.fn(() => Promise.resolve());
  const fail = vi.fn(() => Promise.resolve());
  const repository: JobLeaseRepository = {
    enqueue: vi.fn(() => Promise.resolve()),
    claim: vi.fn(() => Promise.resolve(leases)),
    renew: vi.fn(() => Promise.reject(new Error("UNUSED"))),
    release: vi.fn(() => Promise.resolve()),
    complete,
    fail,
    list: vi.fn(() => Promise.resolve({ items: [] })),
  };
  return { repository, complete, fail };
}

function jobLease(jobType: string): JobLease {
  const time = new Date("2026-07-26T00:00:00.000Z");
  return {
    job: {
      jobId: "job-1",
      jobType,
      payload: {},
      status: "leased",
      attempt: 1,
      availableAt: time,
      createdAt: time,
      updatedAt: time,
    },
    owner: "worker-1",
    token: "11111111-1111-4111-8111-111111111111",
    fencingToken: 1n,
    expiresAt: new Date("2026-07-26T00:01:00.000Z"),
  };
}

function workerConfig(overrides: Partial<ReturnType<typeof workerConfigBase>> = {}) {
  return { ...workerConfigBase(), ...overrides };
}

function workerConfigBase() {
  return {
    databaseUrlFile: "/secret/database-url",
    workerId: "worker-1",
    pollIntervalMs: 10,
    leaseDurationMs: 30_000,
    claimLimit: 10,
    retryDelayMs: 5_000,
    workspaceRoot: "/workspace",
  };
}
