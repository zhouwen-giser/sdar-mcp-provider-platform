import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type {
  RegistrySnapshot,
  RegistrySnapshotDiff,
  RegistrySnapshotPublication,
  RegistrySnapshotRepository,
} from "../../../packages/registry-snapshot/src/index.js";
import { createPmsApi } from "../src/app.js";
import { PmsApiAuthorizationError, type PmsApiRoleAuthorizer } from "../src/authorization.js";
import { provider, snapshot } from "./sdar-registry-projection.unit.test.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("SDAR Registry projection HTTP, auth, and native regression", () => {
  it("serves strict latest/bootstrap DTOs, projection ETag, 304, and native lineage", async () => {
    const repository = new MutableRegistryRepository(validSnapshot());
    const app = api(repository);
    const latestUrl = projectionUrl("latest");

    const latest = await app.inject({ method: "GET", url: latestUrl, headers: authorization() });
    expect(latest.statusCode).toBe(200);
    const body = latest.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual([
      "checksum",
      "expiresAt",
      "generatedAt",
      "providers",
      "revision",
    ]);
    expect(JSON.stringify(body)).not.toMatch(
      /tools|displayName|entity_id|device-secret|taskBehavior|taskId/u,
    );
    const etag = latest.headers.etag;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/u);
    expect(latest.headers["x-smpp-native-revision"]).toBe("4");
    expect(latest.headers["x-smpp-native-checksum"]).toBe("a".repeat(64));
    expect(latest.headers["x-smpp-projection-contract"]).toBe("sdar-registry-v1");

    for (const route of ["latest", "bootstrap"] as const) {
      const notModified = await app.inject({
        method: "GET",
        url: projectionUrl(route),
        headers: { ...authorization(), "if-none-match": etag as string },
      });
      expect(notModified.statusCode, route).toBe(304);
      expect(notModified.body, route).toBe("");
      expect(notModified.headers.etag, route).toBe(etag);
      expect(notModified.headers["x-smpp-native-revision"], route).toBe("4");
      expect(notModified.headers["x-smpp-native-checksum"], route).toBe("a".repeat(64));
      expect(notModified.headers["x-smpp-projection-contract"], route).toBe("sdar-registry-v1");
    }

    const bootstrap = await app.inject({
      method: "GET",
      url: projectionUrl("bootstrap"),
      headers: authorization(),
    });
    expect(bootstrap.json()).toEqual(body);
  });

  it("returns an exact, redacted 404 when native LKG is absent", async () => {
    const app = api(new MutableRegistryRepository(null));
    for (const route of ["latest", "bootstrap"] as const) {
      const response = await app.inject({
        method: "GET",
        url: projectionUrl(route),
        headers: authorization(),
      });
      expect(response.statusCode, route).toBe(404);
      expect(response.json()).toMatchObject({
        error: { code: "SDAR_REGISTRY_PROJECTION_NOT_FOUND" },
      });
      expect(response.body).not.toContain('revision":0');
    }
  });

  it("reuses PMS Bearer auth on latest, bootstrap, and watch", async () => {
    const app = api(new MutableRegistryRepository(validSnapshot()));
    for (const route of ["latest", "bootstrap", "watch"] as const) {
      const response = await app.inject({ method: "GET", url: projectionUrl(route) });
      expect(response.statusCode, route).toBe(401);
      expect(response.json(), route).toMatchObject({
        error: { code: "MANAGEMENT_AUTHENTICATION_REQUIRED" },
      });
    }
  });

  it("strictly validates source paths and never exposes credential-bearing endpoints", async () => {
    const repository = new MutableRegistryRepository(validSnapshot());
    const app = api(repository);
    const invalidSource = await app.inject({
      method: "GET",
      url: "/api/v1/registry/home-lab/consumers/sdar/v1/sources/bad%20source/latest",
      headers: authorization(),
    });
    expect(invalidSource.statusCode).toBe(400);
    expect(invalidSource.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(invalidSource.body).not.toContain("bad source");

    repository.current = snapshot([
      provider(
        "ha-light-lab",
        "ha-light-server",
        "https://device-user:device-secret@runtime.example/mcp",
        7,
      ),
    ]);
    const unsafeEndpoint = await app.inject({
      method: "GET",
      url: projectionUrl("latest"),
      headers: authorization(),
    });
    expect(unsafeEndpoint.statusCode).toBe(500);
    expect(unsafeEndpoint.json()).toMatchObject({
      error: {
        code: "SDAR_REGISTRY_PROJECTION_ENDPOINT_INVALID",
        message: "The Registry snapshot cannot be projected safely",
      },
    });
    expect(unsafeEndpoint.body).not.toMatch(/device-user|device-secret|runtime\.example/u);
  });

  it("leaves the native Registry route and DTO unchanged", async () => {
    const app = api(new MutableRegistryRepository(validSnapshot()));
    const native = await app.inject({
      method: "GET",
      url: "/api/v1/registry/home-lab/latest",
      headers: authorization(),
    });
    const projection = await app.inject({
      method: "GET",
      url: projectionUrl("latest"),
      headers: authorization(),
    });

    expect(native.statusCode).toBe(200);
    expect(native.json()).toMatchObject({
      environment: "home-lab",
      revision: 4,
      checksum: "a".repeat(64),
      document: { providers: [{ tools: [{ name: "operate_entity_id" }] }] },
    });
    expect(JSON.stringify(projection.json())).not.toContain("operate_entity_id");
  });

  it("streams hint-only revisions and stops polling after the client disconnects", async () => {
    const repository = new MutableRegistryRepository(validSnapshot());
    const app = api(repository);
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}${projectionUrl("watch")}`, {
      headers: authorization(),
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-smpp-native-revision")).toBe("4");
    expect(response.headers.get("x-smpp-native-checksum")).toBe("a".repeat(64));
    expect(response.headers.get("x-smpp-projection-contract")).toBe("sdar-registry-v1");
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("SDAR_REGISTRY_WATCH_BODY_MISSING");
    const first = await readUntil(reader, '"revision":4');
    expect(first).toContain("event: revision");
    expect(first).toContain('"smppSourceId":"home-lab-smpp"');
    expect(first).not.toMatch(/providers|tools|entity_id|task|secret/u);

    repository.current = snapshot([], {
      revision: 5,
      checksum: "b".repeat(64),
      publishedAt: new Date("2026-08-05T00:00:00.000Z"),
    });
    const second = await readUntil(reader, '"revision":5');
    expect(second).toContain('"environment":"home-lab"');
    expect(second).toContain('"checksum"');
    expect(second).not.toMatch(/providers|serverEndpoint|catalogRevision/u);

    controller.abort();
    await delay(30);
    const settledCalls = repository.latestCalls;
    await delay(40);
    expect(repository.latestCalls).toBe(settledCalls);
  });
});

class MutableRegistryRepository implements RegistrySnapshotRepository {
  latestCalls = 0;

  constructor(public current: RegistrySnapshot | null) {}

  publish(): Promise<RegistrySnapshotPublication> {
    return Promise.reject(new Error("UNUSED"));
  }

  latest(environment: string): Promise<RegistrySnapshot | null> {
    this.latestCalls += 1;
    return Promise.resolve(this.current?.environment === environment ? this.current : null);
  }

  get(): Promise<RegistrySnapshot | null> {
    return Promise.resolve(null);
  }

  history(): Promise<readonly RegistrySnapshot[]> {
    return Promise.resolve([]);
  }

  diff(): Promise<RegistrySnapshotDiff> {
    return Promise.reject(new Error("UNUSED"));
  }
}

function api(repository: MutableRegistryRepository): FastifyInstance {
  const app = createPmsApi({
    registrySnapshots: repository,
    registryWatchPollIntervalMs: 10,
    sdarRegistryProjectionTtlSeconds: 2_592_000,
    managementAuthorizer: readerAuthorizer(),
  });
  apps.push(app);
  return app;
}

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

function projectionUrl(route: "latest" | "bootstrap" | "watch"): string {
  return `/api/v1/registry/home-lab/consumers/sdar/v1/sources/home-lab-smpp/${route}`;
}

function validSnapshot(): RegistrySnapshot {
  return snapshot([provider("ha-light-lab", "ha-light-server", "http://127.0.0.1:18082/mcp", 7)]);
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let content = "";
  while (!content.includes(marker)) {
    const result = await reader.read();
    if (result.done) throw new Error("SDAR_REGISTRY_WATCH_ENDED");
    content += decoder.decode(result.value, { stream: true });
  }
  return content;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
