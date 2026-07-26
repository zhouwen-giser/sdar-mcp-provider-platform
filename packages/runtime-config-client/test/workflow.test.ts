import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalSha256 } from "@sdar/runtime-configuration-contract";
import {
  FileRuntimeConfigAckOutbox,
  RuntimeConfigApplyHandlerRegistry,
  RuntimeConfigClient,
  RuntimeConfigWorkflow,
  type RuntimeConfigAckOutbox,
  type RuntimeConfigAckOutboxRecord,
  type RuntimeConfigAcknowledgement,
  type RuntimeConfigAcknowledgementPort,
  type RuntimeConfigCacheArtifact,
  type RuntimeConfigCacheStore,
  type RuntimeConfigDocument,
  type RuntimeConfigHttpPort,
  type RuntimeConfigTarget,
  type RuntimeConfigWatchPort,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("RuntimeConfigWorkflow", () => {
  it("applies by config group and promotes to LKG only after success", async () => {
    const old = document("a");
    const candidate = { ...document("b"), applyMode: "reconnect_required" as const };
    const cache = memoryCache(artifact(old));
    const apply = vi.fn(() => Promise.resolve());
    const registry = new RuntimeConfigApplyHandlerRegistry();
    registry.register(target.configGroup, { apply });
    const acks = acknowledgementPort();
    const workflow = createWorkflow(candidate, cache, registry, acks, memoryOutbox());

    await expect(workflow.syncOnce()).resolves.toMatchObject({ state: "applied" });

    expect(apply).toHaveBeenCalledWith(candidate, "reconnect_required");
    expect((await cache.read()) as RuntimeConfigCacheArtifact).toMatchObject({
      document: { checksum: "b".repeat(64) },
    });
    expect(acks.values).toEqual([
      {
        revisionId: candidate.revisionId,
        status: "applied",
        appliedChecksum: candidate.checksum,
      },
    ]);
  });

  it("keeps the previous LKG and sends rejected when apply fails", async () => {
    const oldArtifact = artifact(document("a"));
    const cache = memoryCache(oldArtifact);
    const registry = new RuntimeConfigApplyHandlerRegistry();
    registry.register(target.configGroup, {
      apply: () => Promise.reject(new Error("HANDLER_FAILED")),
    });
    const acks = acknowledgementPort();
    const workflow = createWorkflow(document("b"), cache, registry, acks, memoryOutbox());

    await expect(workflow.syncOnce()).resolves.toMatchObject({
      state: "rejected",
      reasonCode: "RUNTIME_CONFIG_APPLY_FAILED",
    });

    expect(await cache.read()).toEqual(oldArtifact);
    expect(acks.values).toEqual([
      {
        revisionId: document("b").revisionId,
        status: "rejected",
        reasonCode: "RUNTIME_CONFIG_APPLY_FAILED",
      },
    ]);
  });

  it("does not hot-apply or promote restart-required and immutable candidates", async () => {
    for (const [applyMode, status, reasonCode] of [
      ["restart_required", "restart_required", undefined],
      ["immutable", "rejected", "RUNTIME_CONFIG_IMMUTABLE"],
    ] as const) {
      const oldArtifact = artifact(document("a"));
      const cache = memoryCache(oldArtifact);
      const apply = vi.fn(() => Promise.resolve());
      const registry = new RuntimeConfigApplyHandlerRegistry();
      registry.register(target.configGroup, { apply });
      const acks = acknowledgementPort();
      const candidate = { ...document("b"), applyMode };
      const workflow = createWorkflow(candidate, cache, registry, acks, memoryOutbox());

      await workflow.syncOnce();

      expect(apply).not.toHaveBeenCalled();
      expect(await cache.read()).toEqual(oldArtifact);
      expect(acks.values).toEqual([
        {
          revisionId: candidate.revisionId,
          status,
          ...(reasonCode === undefined ? {} : { reasonCode }),
        },
      ]);
    }
  });

  it("continues with LKG during PMS outage without invoking apply", async () => {
    const cache = memoryCache(artifact(document("a")));
    const apply = vi.fn(() => Promise.resolve());
    const registry = new RuntimeConfigApplyHandlerRegistry();
    registry.register(target.configGroup, { apply });
    const client = new RuntimeConfigClient(
      { latest: () => Promise.reject(new Error("PMS_OFFLINE")) },
      cache,
      { validate: () => ({ valid: true }) },
      { maximumAttempts: 1 },
    );
    const workflow = new RuntimeConfigWorkflow(
      target,
      client,
      cache,
      registry,
      acknowledgementPort(),
      memoryOutbox(),
    );

    await expect(workflow.syncOnce()).resolves.toMatchObject({
      state: "lkg",
      document: { checksum: "a".repeat(64) },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("retains failed acknowledgements in the outbox and retries independently", async () => {
    const cache = memoryCache(artifact(document("a")));
    const registry = new RuntimeConfigApplyHandlerRegistry();
    registry.register(target.configGroup, { apply: () => Promise.resolve() });
    let available = false;
    const values: RuntimeConfigAcknowledgement[] = [];
    const acknowledgements: RuntimeConfigAcknowledgementPort = {
      acknowledge: (_target, acknowledgement) => {
        if (!available) return Promise.reject(new Error("PMS_OFFLINE"));
        values.push(acknowledgement);
        return Promise.resolve();
      },
    };
    const outbox = memoryOutbox();
    const workflow = createWorkflow(document("b"), cache, registry, acknowledgements, outbox);

    await expect(workflow.syncOnce()).resolves.toMatchObject({ state: "applied" });
    expect(await outbox.list()).toHaveLength(1);
    expect((await cache.read()) as RuntimeConfigCacheArtifact).toMatchObject({
      document: { checksum: "b".repeat(64) },
    });

    available = true;
    await workflow.flushAcknowledgements();
    expect(values).toHaveLength(1);
    expect(await outbox.list()).toEqual([]);
  });

  it("reconnects Watch with backoff and always pulls authoritative latest", async () => {
    const cache = memoryCache(artifact(document("a")));
    let latestCalls = 0;
    const controller = new AbortController();
    const httpPort: RuntimeConfigHttpPort = {
      latest: () => {
        latestCalls += 1;
        if (latestCalls === 1) {
          return Promise.resolve({
            status: 200,
            etag: quoted("b"),
            body: document("b"),
          });
        }
        controller.abort();
        return Promise.resolve({ status: 304, etag: quoted("b") });
      },
    };
    let watchConnections = 0;
    const watch: RuntimeConfigWatchPort = {
      watch: () => {
        watchConnections += 1;
        if (watchConnections === 1) throw new Error("SSE_DISCONNECTED");
        return (async function* () {
          await Promise.resolve();
          yield { revisionId: document("b").revisionId, revision: 2, checksum: "0".repeat(64) };
        })();
      },
    };
    const registry = new RuntimeConfigApplyHandlerRegistry();
    registry.register(target.configGroup, { apply: () => Promise.resolve() });
    const reconnectDelay = vi.fn(() => Promise.resolve());
    const workflow = new RuntimeConfigWorkflow(
      target,
      new RuntimeConfigClient(httpPort, cache, { validate: () => ({ valid: true }) }),
      cache,
      registry,
      acknowledgementPort(),
      memoryOutbox(),
      watch,
      { reconnectDelay },
    );

    await workflow.run(controller.signal);

    expect(watchConnections).toBe(2);
    expect(reconnectDelay).toHaveBeenCalledWith(1);
    expect(latestCalls).toBe(2);
  });

  it("persists a checksummed 0600 Ack outbox", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sdar-runtime-ack-"));
    temporaryDirectories.push(directory);
    const outbox = new FileRuntimeConfigAckOutbox(join(directory, "acks.json"));
    const record: RuntimeConfigAckOutboxRecord = {
      target,
      acknowledgement: {
        revisionId: document("a").revisionId,
        status: "unavailable",
        reasonCode: "PMS_UNAVAILABLE",
      },
    };

    await outbox.put(record);
    expect(await outbox.list()).toEqual([record]);
    await outbox.remove(record.acknowledgement.revisionId);
    expect(await outbox.list()).toEqual([]);
  });
});

function createWorkflow(
  candidate: RuntimeConfigDocument,
  cache: RuntimeConfigCacheStore,
  registry: RuntimeConfigApplyHandlerRegistry,
  acknowledgements: RuntimeConfigAcknowledgementPort,
  outbox: RuntimeConfigAckOutbox,
): RuntimeConfigWorkflow {
  return new RuntimeConfigWorkflow(
    target,
    new RuntimeConfigClient(
      { latest: () => Promise.resolve({ status: 200, etag: quoted("b"), body: candidate }) },
      cache,
      { validate: () => ({ valid: true }) },
      { maximumAttempts: 1 },
    ),
    cache,
    registry,
    acknowledgements,
    outbox,
  );
}

function acknowledgementPort(): RuntimeConfigAcknowledgementPort & {
  readonly values: RuntimeConfigAcknowledgement[];
} {
  const values: RuntimeConfigAcknowledgement[] = [];
  return {
    values,
    acknowledge: (_target, acknowledgement) => {
      values.push(structuredClone(acknowledgement));
      return Promise.resolve();
    },
  };
}

function memoryOutbox(): RuntimeConfigAckOutbox {
  let records: RuntimeConfigAckOutboxRecord[] = [];
  return {
    list: () => Promise.resolve(structuredClone(records)),
    put: (record) => {
      const existing = records.find(
        ({ acknowledgement }) => acknowledgement.revisionId === record.acknowledgement.revisionId,
      );
      if (existing === undefined) records.push(structuredClone(record));
      return Promise.resolve();
    },
    remove: (revisionId) => {
      records = records.filter(({ acknowledgement }) => acknowledgement.revisionId !== revisionId);
      return Promise.resolve();
    },
  };
}

function memoryCache(initial: unknown): RuntimeConfigCacheStore {
  let value = structuredClone(initial);
  return {
    read: () => Promise.resolve(structuredClone(value)),
    write: (artifact) => {
      value = structuredClone(artifact);
      return Promise.resolve();
    },
  };
}

function artifact(value: RuntimeConfigDocument): RuntimeConfigCacheArtifact {
  const payload = {
    formatVersion: 1 as const,
    etag: quoted(value.checksum[0] ?? "a"),
    document: value,
  };
  return { ...payload, artifactChecksum: canonicalSha256(payload) };
}

function document(character: string): RuntimeConfigDocument {
  return {
    revisionId:
      character === "a"
        ? "00000000-0000-4000-8000-000000000001"
        : "00000000-0000-4000-8000-000000000002",
    revision: character === "a" ? 1 : 2,
    checksum: character.repeat(64),
    applyMode: "hot_reload",
    sourceTargetType: "runtime_deployment",
    identity: {
      environment: target.environment,
      deploymentId: target.deploymentId,
      instanceId: target.instanceId,
      providerId: "provider-1",
    },
    content: { ENABLED: true },
  };
}

function quoted(character: string): string {
  return `"${character.repeat(64)}"`;
}

const target: RuntimeConfigTarget = {
  environment: "production",
  deploymentId: "deployment-1",
  instanceId: "instance-1",
  configGroup: "runtime.observability",
  dataId: "main",
};
