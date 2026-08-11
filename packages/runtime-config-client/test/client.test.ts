import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalSha256 } from "@sdar/runtime-configuration-contract";
import {
  FileRuntimeConfigCacheStore,
  RuntimeConfigClient,
  type RuntimeConfigCacheArtifact,
  type RuntimeConfigCacheStore,
  type RuntimeConfigContentValidator,
  type RuntimeConfigDocument,
  type RuntimeConfigHttpPort,
  type RuntimeConfigTarget,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("RuntimeConfigClient", () => {
  it("validates a 200 response and commits a checksummed LKG", async () => {
    const store = memoryStore();
    const document = configDocument("a");
    const client = new RuntimeConfigClient(
      http(() => Promise.resolve({ status: 200, etag: quoted("a"), body: document })),
      store,
      validSchema(),
      { maximumAttempts: 1 },
    );

    const result = await client.pull(target);

    expect(result).toMatchObject({
      source: "remote",
      changed: true,
      etag: quoted("a"),
      document: { revision: 1, checksum: "a".repeat(64) },
    });
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]?.artifactChecksum).toBe(
      canonicalSha256({
        formatVersion: 1,
        etag: quoted("a"),
        document,
      }),
    );
  });

  it("uses If-None-Match and performs no write on 304", async () => {
    const existing = artifact(configDocument("a"), quoted("a"));
    const store = memoryStore(existing);
    const latest = vi.fn(() => Promise.resolve({ status: 304 as const, etag: quoted("a") }));
    const client = new RuntimeConfigClient(http(latest), store, validSchema(), {
      maximumAttempts: 1,
    });

    const result = await client.pull(target);

    expect(result).toMatchObject({ source: "lkg", changed: false });
    expect(latest).toHaveBeenCalledWith(expect.objectContaining({ ifNoneMatch: quoted("a") }));
    expect(store.writes).toHaveLength(0);
  });

  it("never replaces LKG with a checksum or schema-invalid download", async () => {
    for (const invalidBody of [
      { ...configDocument("b"), checksum: "c".repeat(64) },
      { ...configDocument("b"), content: { ENABLED: "not-boolean" } },
      {
        ...configDocument("b"),
        identity: { ...configDocument("b").identity, instanceId: "another-instance" },
      },
    ]) {
      const store = memoryStore(artifact(configDocument("a"), quoted("a")));
      const client = new RuntimeConfigClient(
        http(() => Promise.resolve({ status: 200, etag: quoted("b"), body: invalidBody })),
        store,
        {
          validate: (content) => ({
            valid: typeof content.ENABLED === "boolean",
          }),
        },
        { maximumAttempts: 1 },
      );

      const result = await client.pull(target);

      expect(result).toMatchObject({
        source: "lkg",
        fallbackReason: "RUNTIME_CONFIG_RESPONSE_INVALID",
        document: { checksum: "a".repeat(64) },
      });
      expect(store.writes).toHaveLength(0);
    }
  });

  it("returns LKG during PMS outage and retries before a successful pull", async () => {
    const fallbackStore = memoryStore(artifact(configDocument("a"), quoted("a")));
    const unavailable = new RuntimeConfigClient(
      http(() => Promise.reject(new Error("PMS_OFFLINE"))),
      fallbackStore,
      validSchema(),
      { maximumAttempts: 2, retryDelay: () => Promise.resolve() },
    );
    await expect(unavailable.pull(target)).resolves.toMatchObject({
      source: "lkg",
      fallbackReason: "RUNTIME_CONFIG_PULL_UNAVAILABLE",
    });

    let attempts = 0;
    const delay = vi.fn(() => Promise.resolve());
    const recovering = new RuntimeConfigClient(
      http(() => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("TRANSIENT"))
          : Promise.resolve({
              status: 200,
              etag: quoted("b"),
              body: configDocument("b"),
            });
      }),
      memoryStore(),
      validSchema(),
      { maximumAttempts: 2, retryDelay: delay },
    );
    await expect(recovering.pull(target)).resolves.toMatchObject({ source: "remote" });
    expect(delay).toHaveBeenCalledWith(1);
  });

  it("returns a stable timeout error when no LKG exists", async () => {
    const client = new RuntimeConfigClient(
      http(
        ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
      memoryStore(),
      validSchema(),
      { timeoutMs: 5, maximumAttempts: 1 },
    );

    await expect(client.pull(target)).rejects.toMatchObject({
      code: "RUNTIME_CONFIG_PULL_TIMEOUT",
      retryable: true,
    });
  });

  it("writes a staging artifact, uses 0600 on POSIX, and atomically renames it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sdar-runtime-config-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "runtime-config-lkg.json");
    const store = new FileRuntimeConfigCacheStore(path);
    const expected = artifact(configDocument("a"), quoted("a"));

    await store.write(expected);

    expect(await store.read()).toEqual(expected);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(["runtime-config-lkg.json"]);
  });

  it("detects a corrupted cache artifact before using it as LKG", async () => {
    const broken = {
      ...artifact(configDocument("a"), quoted("a")),
      artifactChecksum: "f".repeat(64),
    };
    const client = new RuntimeConfigClient(
      http(() => Promise.reject(new Error("PMS_OFFLINE"))),
      memoryStore(broken),
      validSchema(),
      { maximumAttempts: 1 },
    );

    await expect(client.pull(target)).rejects.toMatchObject({
      code: "RUNTIME_CONFIG_PULL_UNAVAILABLE",
    });
  });
});

function http(implementation: RuntimeConfigHttpPort["latest"]): RuntimeConfigHttpPort {
  return { latest: implementation };
}

function memoryStore(initial: unknown = null): RuntimeConfigCacheStore & {
  readonly writes: RuntimeConfigCacheArtifact[];
} {
  let value = initial;
  const writes: RuntimeConfigCacheArtifact[] = [];
  return {
    writes,
    read: () => Promise.resolve(structuredClone(value)),
    write: (artifact) => {
      value = structuredClone(artifact);
      writes.push(structuredClone(artifact));
      return Promise.resolve();
    },
  };
}

function validSchema(): RuntimeConfigContentValidator {
  return { validate: () => ({ valid: true }) };
}

function artifact(document: RuntimeConfigDocument, etag: string): RuntimeConfigCacheArtifact {
  const payload = { formatVersion: 1 as const, etag, document };
  return { ...payload, artifactChecksum: canonicalSha256(payload) };
}

function configDocument(character: string): RuntimeConfigDocument {
  return {
    revisionId: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    checksum: character.repeat(64),
    applyMode: "hot_reload",
    sourceTargetType: "runtime_deployment",
    identity: {
      environment: "production",
      deploymentId: "deployment-1",
      instanceId: "instance-1",
      providerId: "provider-1",
    },
    content: { ENABLED: true, API_TOKEN_FILE: { secretRef: "local/runtime/token" } },
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
