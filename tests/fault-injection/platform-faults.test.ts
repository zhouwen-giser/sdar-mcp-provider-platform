import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { canonicalSha256 } from "../../packages/runtime-configuration-contract/src/index.js";
import {
  RuntimeConfigClient,
  type RuntimeConfigCacheArtifact,
  type RuntimeConfigDocument,
} from "../../packages/runtime-config-client/src/index.js";
import {
  RuntimeCrashRecoveryController,
  RuntimeHealthProbe,
  type RuntimeRecoveryRecord,
} from "../../packages/pm2-runtime-adapter/src/index.js";
import {
  RuntimeMigrationRunner,
  RuntimeMigrationRunnerError,
} from "../../packages/runtime-migration-runner/src/index.js";

describe("Goal 2 platform fault injection", () => {
  it("uses Runtime LKG during PMS outage while Task work continues", async () => {
    const existing = artifact(document());
    let taskProgress = 0;
    const writes: RuntimeConfigCacheArtifact[] = [];
    const client = new RuntimeConfigClient(
      { latest: () => Promise.reject(new Error("PMS_PRIVATE_OUTAGE_DETAIL")) },
      {
        read: () => Promise.resolve(structuredClone(existing)),
        write: (value) => {
          writes.push(value);
          return Promise.resolve();
        },
      },
      { validate: () => ({ valid: true }) },
      {
        maximumAttempts: 3,
        retryDelay: () => {
          taskProgress += 1;
          return Promise.resolve();
        },
      },
    );

    const result = await client.pull({
      environment: "production",
      deploymentId: "deployment-1",
      instanceId: "instance-1",
      configGroup: "runtime.observability",
      dataId: "main",
    });

    expect(result).toMatchObject({
      source: "lkg",
      changed: false,
      fallbackReason: "RUNTIME_CONFIG_PULL_UNAVAILABLE",
    });
    expect(taskProgress).toBe(2);
    expect(writes).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("PMS_PRIVATE_OUTAGE_DETAIL");
  });

  it("keeps PM2 online separate from Adapter readiness failure", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(200, { status: "live" }))
      .mockResolvedValueOnce(
        json(503, {
          status: "not_ready",
          dependencies: { database: "ready", adapter: "failed", adapterManifest: "ready" },
        }),
      );
    const result = await new RuntimeHealthProbe(
      { describe: () => Promise.resolve(processObservation("online", 0)) },
      { fetch },
    ).probe({
      target: processObservation("online", 0).target,
      httpPort: 18_080,
      timeoutMs: 100,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      processState: "online",
      live: true,
      ready: false,
      reasonCode: "ADAPTER_NOT_READY",
    });
  });

  it("persists bounded Runtime crash recovery and returns healthy only after online", async () => {
    const records = new Map<string, RuntimeRecoveryRecord>();
    const statuses: unknown[] = [];
    const controller = new RuntimeCrashRecoveryController({
      policy: {
        restartDelayMs: 5_000,
        maxRestarts: 5,
        maxMemoryBytes: 512 * 1024 * 1024,
        minUptimeMs: 10_000,
      },
      stateStore: {
        get: (instanceId) => Promise.resolve(records.get(instanceId) ?? null),
        save: (record) => {
          records.set(record.instanceId, record);
          return Promise.resolve();
        },
      },
      deploymentStatus: {
        setObservedStatus: (status) => {
          statuses.push(status);
          return Promise.resolve();
        },
      },
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });

    const failed = await controller.observe(processObservation("errored", 1));
    const recovered = await controller.observe(processObservation("online", 1));

    expect(failed).toMatchObject({
      state: "backoff",
      automaticRestartAllowed: true,
      retryAfterMs: 5_000,
    });
    expect(recovered).toMatchObject({
      state: "healthy",
      automaticRestartAllowed: true,
      manualInterventionRequired: false,
    });
    expect(statuses).toHaveLength(1);
    expect(records.get("instance-1")).toMatchObject({ consecutiveFailures: 0, revision: 2 });
  });

  it("fails closed with redacted, retryable evidence when migration DB is unavailable", async () => {
    const pool = {
      query: vi.fn(() => Promise.resolve({ rows: [{ present: false }] })),
    } as unknown as Pool;
    const runner = new RuntimeMigrationRunner(pool, {
      supportedRuntimeVersions: ["2.0.0-rc.1"],
      timeoutMs: 1_000,
      workspaceRoot: process.cwd(),
      engine: () =>
        Promise.reject(
          Object.assign(new Error("password=private host=internal"), { code: "08006" }),
        ),
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });

    const error = await runner.run(migrationRequest()).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RuntimeMigrationRunnerError);
    expect(error).toMatchObject({
      code: "RUNTIME_MIGRATION_DATABASE_UNAVAILABLE",
      retryable: true,
      evidence: {
        status: "FAIL",
        error: { code: "RUNTIME_MIGRATION_DATABASE_UNAVAILABLE", retryable: true },
      },
    });
    expect(JSON.stringify(error)).not.toContain("password=private");
  });
});

function document(): RuntimeConfigDocument {
  return {
    revisionId: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    checksum: "a".repeat(64),
    applyMode: "hot_reload",
    sourceTargetType: "runtime_deployment",
    identity: {
      environment: "production",
      deploymentId: "deployment-1",
      instanceId: "instance-1",
      providerId: "provider-1",
    },
    content: { ENABLED: true },
  };
}

function artifact(value: RuntimeConfigDocument): RuntimeConfigCacheArtifact {
  const payload = { formatVersion: 1 as const, etag: `"${value.checksum}"`, document: value };
  return { ...payload, artifactChecksum: canonicalSha256(payload) };
}

function processObservation(state: "online" | "errored", restartCount: number) {
  return {
    target: {
      providerId: "provider-a",
      deploymentId: "deployment-1",
      environment: "production",
      runtimeVersion: "2.0.0-rc.1",
      instanceId: "instance-1",
      ordinal: 0,
      processName: "sdar-runtime-provider-a-0",
    },
    state,
    restartCount,
  } as const;
}

function migrationRequest() {
  return {
    deploymentId: "deployment-1",
    providerId: "provider-1",
    runtimeVersion: "2.0.0-rc.1",
    migrationSet: "runtime",
  } as const;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
