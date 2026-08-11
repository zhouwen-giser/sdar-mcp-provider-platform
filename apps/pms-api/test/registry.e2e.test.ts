import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogSnapshot, CatalogTool } from "../../../packages/catalog-manager/src/index.js";
import {
  PostgresRegistrySnapshotRepository,
  runPmsMigrations,
} from "../../../packages/pms-persistence-postgres/src/index.js";
import {
  buildRegistrySnapshot,
  type RegistryProviderInput,
} from "../../../packages/registry-snapshot/src/index.js";
import { createPmsApi, PmsApiAuthorizationError, type PmsApiRoleAuthorizer } from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");

describe("SDAR Registry Snapshot API", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `registry_api_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  let repository: PostgresRegistrySnapshotRepository;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    repository = new PostgresRegistrySnapshotRepository(pool);
    await repository.publish(publication(["provider-a"]));
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("requires reader authorization and serves latest with a strong ETag", async () => {
    const app = api();
    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/registry/production/latest",
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/registry/production/latest",
      headers: authorization(),
    });

    expect(denied.statusCode).toBe(401);
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      revision: number;
      checksum: string;
      document: { providers: Record<string, unknown>[] };
    }>();
    expect(response.headers.etag).toBe(`"${body.checksum}"`);
    expect(body).toMatchObject({
      revision: 1,
      document: {
        providers: [
          {
            providerId: "provider-a",
            serverId: "server-provider-a",
            protocolMode: "frozen_v1",
            effectiveEndpoint: "https://provider-a.example.test/mcp",
            catalogRevision: 1,
          },
        ],
      },
    });
    for (const forbidden of ["secret", "credential", "pm2", "taskId", '"pid"', '"port"']) {
      expect(response.body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    await app.close();
  });

  it("returns 304 for a matching ETag and keeps no-op publication stable", async () => {
    const noOp = await repository.publish(publication(["provider-a"]));
    const app = api();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/registry/production/latest",
      headers: {
        ...authorization(),
        "if-none-match": `W/"${noOp.snapshot.checksum}"`,
      },
    });

    expect(noOp).toMatchObject({ created: false, snapshot: { revision: 1 } });
    expect(response.statusCode).toBe(304);
    expect(response.body).toBe("");
    expect(response.headers.etag).toBe(`"${noOp.snapshot.checksum}"`);
    await app.close();
  });

  it("projects the committed PostgreSQL native LKG through the strict SDAR consumer route", async () => {
    const native = await repository.latest("production");
    if (native === null) throw new Error("REGISTRY_NATIVE_LKG_MISSING");
    const app = api();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/registry/production/consumers/sdar/v1/sources/home-lab-smpp/latest",
      headers: authorization(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      readonly revision: number;
      readonly checksum: string;
      readonly generatedAt: string;
      readonly expiresAt: string;
      readonly providers: readonly Record<string, unknown>[];
    }>();
    expect(Object.keys(body).sort()).toEqual([
      "checksum",
      "expiresAt",
      "generatedAt",
      "providers",
      "revision",
    ]);
    expect(body).toMatchObject({
      revision: native.revision,
      generatedAt: native.publishedAt.toISOString(),
      providers: [
        {
          externalProviderId: "provider-a",
          externalServerId: "server-provider-a",
          serverEndpoint: "https://provider-a.example.test/mcp",
          catalogRevision: "1",
          labels: { environment: "production", protocolMode: "frozen_v1" },
        },
      ],
    });
    expect(body.checksum).not.toBe(native.checksum);
    expect(response.headers.etag).toBe(`"${body.checksum}"`);
    expect(response.headers["x-smpp-native-revision"]).toBe(String(native.revision));
    expect(response.headers["x-smpp-native-checksum"]).toBe(native.checksum);
    expect(response.headers["x-smpp-projection-contract"]).toBe("sdar-registry-v1");
    expect(JSON.stringify(body)).not.toMatch(/tools|taskBehavior|entity_id|secret/u);
    await app.close();
  });

  it("serves history, diff, LKG bootstrap, and an explicit empty fallback", async () => {
    await repository.publish(publication(["provider-b"]));
    const app = api();
    const [history, diff, bootstrap, empty] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/v1/registry/production/history?limit=10",
        headers: authorization(),
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/registry/production/diff?fromRevision=1&toRevision=2",
        headers: authorization(),
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/registry/production/bootstrap",
        headers: authorization(),
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/registry/staging/bootstrap",
        headers: authorization(),
      }),
    ]);

    expect(history.json()).toMatchObject({ items: [{ revision: 2 }, { revision: 1 }] });
    expect(diff.json()).toMatchObject({
      added: [{ providerId: "provider-b" }],
      removed: [{ providerId: "provider-a" }],
    });
    expect(bootstrap.json()).toMatchObject({
      source: "registry_lkg",
      snapshot: { revision: 2 },
    });
    expect(empty.json()).toMatchObject({
      source: "empty_safe_default",
      snapshot: {
        environment: "staging",
        revision: 0,
        document: { environment: "staging", providers: [] },
      },
    });
    await app.close();
  });

  it("streams revision/checksum hints and observes a later committed revision", async () => {
    const app = api();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/v1/registry/production/watch`, {
      headers: authorization(),
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("REGISTRY_WATCH_BODY_MISSING");
    const first = await readUntil(reader, '"revision":2');
    expect(first).not.toContain("effectiveEndpoint");

    await repository.publish(publication(["provider-c"]));
    const second = await readUntil(reader, '"revision":3');
    expect(second).toContain('"checksum"');
    expect(second).not.toContain("provider-c");
    controller.abort();
    await app.close();
  });

  function api() {
    return createPmsApi({
      registrySnapshots: repository,
      registryWatchPollIntervalMs: 10,
      managementAuthorizer: readerAuthorizer(),
    });
  }
});

function readerAuthorizer(): PmsApiRoleAuthorizer {
  return {
    authenticate(credentials) {
      if (credentials.authorization !== "Bearer registry-reader") {
        return Promise.reject(new PmsApiAuthorizationError("MANAGEMENT_AUTHENTICATION_REQUIRED"));
      }
      return Promise.resolve({ subjectId: "sdar-reader", roles: ["reader"] });
    },
  };
}

function authorization(): Record<string, string> {
  return { authorization: "Bearer registry-reader" };
}

function publication(providerIds: string[]) {
  return {
    candidate: buildRegistrySnapshot("production", providerIds.map(provider)),
    actorId: "registry-worker",
    correlationId: `publish-${providerIds.join("-")}`,
    publishedAt: new Date("2026-07-26T00:00:00.000Z"),
  };
}

function provider(providerId: string): RegistryProviderInput {
  return {
    providerId,
    serverId: `server-${providerId}`,
    protocolMode: "frozen_v1",
    effectiveEndpoint: `https://${providerId}.example.test`,
    catalog: catalog(providerId),
  };
}

function catalog(providerId: string): CatalogSnapshot {
  return {
    providerId,
    revision: 1,
    checksum: "a".repeat(64),
    document: {
      discovery: {
        resultType: "complete",
        supportedVersions: ["2026-07-28"],
        capabilities: {},
        serverInfo: { name: "runtime", version: "2.0.0" },
      },
      tools: [tool("operate")],
    },
    discoveredAt: new Date("2026-07-26T00:00:00.000Z"),
    createdAt: new Date("2026-07-26T00:00:00.000Z"),
  };
}

function tool(name: string): CatalogTool {
  return {
    name,
    description: `${name} operation`,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    taskExecution: {
      profileVersion: "1.0",
      taskBehavior: "task_required",
      availability: "dynamic",
      supportsScheduling: true,
      supportsMaxElapsed: true,
      supportsObservations: true,
      supportsInputRequired: true,
      idempotency: "server_managed",
    },
  };
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(marker)) {
    const result = await reader.read();
    if (result.done) throw new Error("REGISTRY_WATCH_ENDED");
    text += decoder.decode(result.value, { stream: true });
  }
  return text;
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
