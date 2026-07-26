import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ConfigurationCenter,
  ConfigurationCenterError,
  ConfigurationPublicationService,
  RuntimeConfigAcknowledgementService,
  RuntimeConfigQueryService,
  RuntimeConfigWatchHub,
  type RuntimeConfigClientAuthorizer,
} from "../../../packages/configuration-center/src/index.js";
import {
  PostgresPmsUnitOfWork,
  runPmsMigrations,
} from "../../../packages/pms-persistence-postgres/src/index.js";
import { parseConfigurationDefinition } from "../../../packages/runtime-configuration-contract/src/index.js";
import { createPmsApi } from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const definition = parseConfigurationDefinition({
  schemaVersion: "1.0",
  definitionId: "runtime.e2e",
  definitionVersion: 1,
  configGroup: "runtime.e2e",
  targetTypes: ["runtime_deployment", "runtime_instance"],
  inheritance: {
    enabled: true,
    order: ["runtime_instance", "runtime_deployment", "system_default"],
  },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["PROVIDER_ID", "FEATURE_ENABLED"],
    properties: {
      PROVIDER_ID: { type: "string", minLength: 1 },
      FEATURE_ENABLED: { type: "boolean" },
      API_TOKEN_FILE: { type: "string", minLength: 1 },
    },
  },
  defaults: { PROVIDER_ID: "untrusted-default", FEATURE_ENABLED: false },
  secretPaths: ["/API_TOKEN_FILE"],
  fields: [
    field("PROVIDER_ID", "immutable", false, "forbidden"),
    field("FEATURE_ENABLED", "hot_reload"),
    field("API_TOKEN_FILE", "restart_required", true),
  ],
});

describe("Runtime Config latest API", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `pms_runtime_config_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  let checksum: string;
  let revisionId: string;
  let publicationCenter: ConfigurationCenter;
  let publicationService: ConfigurationPublicationService;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    publicationCenter = deploymentDraft();
    const validated = publicationCenter.validateDraft("deployment-config");
    publicationService = new ConfigurationPublicationService(
      publicationCenter,
      new PostgresPmsUnitOfWork(pool),
    );
    const published = await publicationService.publish(
      {
        draftId: "deployment-config",
        expectedDraftVersion: validated.version,
        expectedPublishedRevision: null,
      },
      { actorId: "admin-1", correlationId: "runtime-config-seed" },
    );
    checksum = published.revision.checksum;
    revisionId = published.revision.revisionId;
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("authenticates independently and falls back from instance to deployment config", async () => {
    const authorize = validAuthorizer();
    const app = createPmsApi({
      runtimeConfigQuery: new RuntimeConfigQueryService(new PostgresPmsUnitOfWork(pool)),
      runtimeConfigAuthorizer: { authorize },
    });

    const response = await app.inject({
      method: "GET",
      url: latestUrl(),
      headers: { authorization: "Bearer runtime-client-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe(`"${checksum}"`);
    expect(response.headers["cache-control"]).toBe("private, no-cache");
    expect(response.json()).toMatchObject({
      checksum,
      sourceTargetType: "runtime_deployment",
      identity: {
        environment: "production",
        deploymentId: "deployment-1",
        instanceId: "instance-1",
        providerId: "provider-authoritative",
      },
      content: {
        PROVIDER_ID: "provider-authoritative",
        FEATURE_ENABLED: true,
        API_TOKEN_FILE: { secretRef: "local/runtime/api-token" },
      },
    });
    expect(response.body).not.toContain("untrusted-default");
    expect(response.body).not.toContain("runtime-client-token");
    expect(authorize).toHaveBeenCalledWith(
      { authorization: "Bearer runtime-client-token" },
      expect.objectContaining({ deploymentId: "deployment-1", instanceId: "instance-1" }),
    );
    await app.close();
  });

  it("returns an empty 304 for matching strong or weak If-None-Match", async () => {
    const app = createPmsApi({
      runtimeConfigQuery: new RuntimeConfigQueryService(new PostgresPmsUnitOfWork(pool)),
      runtimeConfigAuthorizer: { authorize: validAuthorizer() },
    });
    for (const ifNoneMatch of [`"${checksum}"`, `W/"${checksum}"`]) {
      const response = await app.inject({
        method: "GET",
        url: latestUrl(),
        headers: {
          authorization: "Bearer runtime-client-token",
          "if-none-match": ifNoneMatch,
        },
      });
      expect(response.statusCode).toBe(304);
      expect(response.body).toBe("");
      expect(response.headers.etag).toBe(`"${checksum}"`);
    }
    await app.close();
  });

  it("rejects missing credentials and authorized identity/path mismatches", async () => {
    const authorizer: RuntimeConfigClientAuthorizer = {
      authorize(credentials) {
        if (credentials.authorization === undefined) {
          return Promise.reject(
            new ConfigurationCenterError(
              "RUNTIME_CONFIG_UNAUTHORIZED",
              "Missing Runtime credential",
            ),
          );
        }
        return Promise.resolve({
          environment: "production",
          deploymentId: "deployment-1",
          instanceId: "different-instance",
          providerId: "provider-authoritative",
        });
      },
    };
    const app = createPmsApi({
      runtimeConfigQuery: new RuntimeConfigQueryService(new PostgresPmsUnitOfWork(pool)),
      runtimeConfigAuthorizer: authorizer,
    });

    const unauthorized = await app.inject({ method: "GET", url: latestUrl() });
    expect(unauthorized.statusCode).toBe(401);
    const forbidden = await app.inject({
      method: "GET",
      url: latestUrl(),
      headers: { authorization: "Bearer wrong-scope" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.body).not.toContain("wrong-scope");
    await app.close();
  });

  it("fails closed without reflecting a legacy plaintext secret revision", async () => {
    const definitionId = randomUUID();
    const revisionId = randomUUID();
    await pool.query(
      `INSERT INTO config_definition(
         definition_id,environment,target_type,target_id,config_group,data_id,
         schema_document,default_content,secret_paths,field_metadata,status
       ) VALUES (
         $1,'production','runtime_instance','instance-corrupt','runtime.e2e','main',
         '{}'::jsonb,'{}'::jsonb,'["/API_TOKEN_FILE"]'::jsonb,
         '{"logicalDefinitionId":"runtime.e2e"}'::jsonb,'active'
       )`,
      [definitionId],
    );
    await pool.query(
      `INSERT INTO config_revision(
         revision_id,definition_id,revision,checksum,apply_mode,status,
         content,created_by,published_at
       ) VALUES (
         $1,$2,1,$3,'restart_required','published',
         '{"API_TOKEN_FILE":"legacy-plaintext-secret"}'::jsonb,'legacy-import',clock_timestamp()
       )`,
      [revisionId, definitionId, "f".repeat(64)],
    );
    const app = createPmsApi({
      runtimeConfigQuery: new RuntimeConfigQueryService(new PostgresPmsUnitOfWork(pool)),
      runtimeConfigAuthorizer: {
        authorize: () =>
          Promise.resolve({
            environment: "production",
            deploymentId: "deployment-1",
            instanceId: "instance-corrupt",
            providerId: "provider-authoritative",
          }),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: latestUrl("instance-corrupt"),
      headers: { authorization: "Bearer runtime-client-token" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: { code: "RUNTIME_CONFIG_PROJECTION_INVALID" },
    });
    expect(response.body).not.toContain("legacy-plaintext-secret");
    await app.close();
  });

  it("emits a revision/checksum-only hint after a committed publication", async () => {
    const center = new ConfigurationCenter([definition]);
    center.createDraft({
      draftId: "watch-publication",
      definitionId: definition.definitionId,
      key: {
        environment: "production",
        targetType: "runtime_deployment",
        targetId: "deployment-watch",
        configGroup: definition.configGroup,
        dataId: "main",
      },
      content: { FEATURE_ENABLED: true },
    });
    const validated = center.validateDraft("watch-publication");
    const hub = new RuntimeConfigWatchHub();
    const subscription = hub.subscribe({
      environment: "production",
      deploymentId: "deployment-watch",
      instanceId: "instance-watch",
      configGroup: definition.configGroup,
      dataId: "main",
    });
    const service = new ConfigurationPublicationService(center, new PostgresPmsUnitOfWork(pool), {
      onPublished: (event) => hub.publish(event),
    });

    const published = await service.publish(
      {
        draftId: "watch-publication",
        expectedDraftVersion: validated.version,
        expectedPublishedRevision: null,
      },
      { actorId: "admin-1", correlationId: "watch-publication" },
    );
    const hint = await subscription.next();

    expect(hint).toEqual({
      revisionId: published.revision.revisionId,
      revision: published.revision.revision,
      checksum: published.revision.checksum,
    });
    expect(hint).not.toHaveProperty("content");
    subscription.close();
  });

  it("streams an SSE hint without config and supports disconnect-to-latest recovery", async () => {
    const app = createPmsApi({
      runtimeConfigQuery: new RuntimeConfigQueryService(new PostgresPmsUnitOfWork(pool)),
      runtimeConfigAuthorizer: { authorize: validAuthorizer() },
      runtimeConfigWatch: new RuntimeConfigWatchHub(),
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(
      `${address}/api/v1/runtime-config/deployments/deployment-1/instances/instance-1/watch?environment=production&configGroup=runtime.e2e&dataId=main`,
      {
        headers: { authorization: "Bearer runtime-client-token" },
        signal: AbortSignal.timeout(5_000),
      },
    );
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("SSE_RESPONSE_BODY_MISSING");
    const first = await reader.read();
    if (!(first.value instanceof Uint8Array)) throw new Error("SSE_FRAME_MISSING");
    const frame = new TextDecoder().decode(first.value);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(frame).toContain("event: revision");
    expect(frame).toContain(`id: ${checksum}`);
    expect(frame).toContain(`"revisionId":"${revisionId}"`);
    for (const forbidden of [
      "content",
      "API_TOKEN_FILE",
      "secretRef",
      "FEATURE_ENABLED",
      "local/runtime/api-token",
    ]) {
      expect(frame).not.toContain(forbidden);
    }
    await reader.cancel();
    await app.close();

    const recovery = createPmsApi({
      runtimeConfigQuery: new RuntimeConfigQueryService(new PostgresPmsUnitOfWork(pool)),
      runtimeConfigAuthorizer: { authorize: validAuthorizer() },
    });
    const latest = await recovery.inject({
      method: "GET",
      url: latestUrl(),
      headers: { authorization: "Bearer runtime-client-token" },
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({ checksum });
    await recovery.close();
  });

  it("stores identical Ack idempotently and rejects conflicts or illegal revisions", async () => {
    const app = createPmsApi({
      runtimeConfigQuery: new RuntimeConfigQueryService(new PostgresPmsUnitOfWork(pool)),
      runtimeConfigAuthorizer: { authorize: validAuthorizer() },
      runtimeConfigAcknowledgements: new RuntimeConfigAcknowledgementService(
        new PostgresPmsUnitOfWork(pool),
      ),
    });
    const url = ackUrl(revisionId);
    const headers = { authorization: "Bearer runtime-client-token" };
    const payload = {
      status: "applied",
      appliedChecksum: checksum,
      details: { applyMode: "hot_reload" },
    };
    const first = await app.inject({ method: "POST", url, headers, payload });
    const duplicate = await app.inject({ method: "POST", url, headers, payload });

    expect(first.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ ackId: first.json<{ ackId: string }>().ackId });
    const stored = await pool.query<{ count: string }>(
      "SELECT count(*) FROM config_ack WHERE revision_id=$1 AND runtime_instance_id='instance-1'",
      [revisionId],
    );
    expect(stored.rows[0]?.count).toBe("1");

    const conflict = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { status: "stale", details: {} },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: "RUNTIME_CONFIG_ACK_CONFLICT" } });

    const missing = await app.inject({
      method: "POST",
      url: ackUrl(randomUUID()),
      headers,
      payload,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      error: { code: "RUNTIME_CONFIG_ACK_REVISION_NOT_FOUND" },
    });

    const unsafe = await app.inject({
      method: "POST",
      url,
      headers,
      payload: {
        status: "rejected",
        reasonCode: "APPLY_FAILED",
        details: { token: "do-not-echo" },
      },
    });
    expect(unsafe.statusCode).toBe(400);
    expect(unsafe.body).not.toContain("do-not-echo");
    await app.close();
  });

  it("closes update→validate→publish→rollback→latest through HTTP", async () => {
    const app = createPmsApi({
      configurationCenter: publicationCenter,
      configurationPublication: publicationService,
      runtimeConfigQuery: new RuntimeConfigQueryService(new PostgresPmsUnitOfWork(pool)),
      runtimeConfigAuthorizer: { authorize: validAuthorizer() },
    });
    const adminHeaders = {
      "x-actor-id": "admin-1",
      "x-correlation-id": "rollback-e2e",
    };
    const updated = await app.inject({
      method: "PATCH",
      url: "/api/v1/config-drafts/deployment-config",
      headers: adminHeaders,
      payload: {
        expectedVersion: 2,
        content: {
          FEATURE_ENABLED: false,
          API_TOKEN_FILE: { secretRef: "local/runtime/api-token" },
        },
      },
    });
    expect(updated.statusCode).toBe(200);
    const validated = await app.inject({
      method: "POST",
      url: "/api/v1/config-drafts/deployment-config/validate",
      headers: adminHeaders,
    });
    expect(validated.json()).toMatchObject({ status: "validated", version: 4 });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/config-drafts/deployment-config/publish",
      headers: adminHeaders,
      payload: { expectedDraftVersion: 4, expectedPublishedRevision: 1 },
    });
    expect(second.json()).toMatchObject({
      outcome: "published",
      revision: { revision: 2 },
    });

    const rollback = await app.inject({
      method: "POST",
      url: "/api/v1/config-drafts/deployment-config/rollback",
      headers: adminHeaders,
      payload: {
        expectedDraftVersion: 4,
        expectedPublishedRevision: 2,
        sourceRevisionId: revisionId,
      },
    });
    expect(rollback.json()).toMatchObject({
      outcome: "published",
      revision: { revision: 3, checksum },
    });
    const latest = await app.inject({
      method: "GET",
      url: latestUrl(),
      headers: { authorization: "Bearer runtime-client-token" },
    });
    expect(latest.json()).toMatchObject({
      revision: 3,
      checksum,
      content: { FEATURE_ENABLED: true },
    });
    await app.close();
  });
});

function deploymentDraft(): ConfigurationCenter {
  const center = new ConfigurationCenter([definition]);
  center.createDraft({
    draftId: "deployment-config",
    definitionId: definition.definitionId,
    key: {
      environment: "production",
      targetType: "runtime_deployment",
      targetId: "deployment-1",
      configGroup: definition.configGroup,
      dataId: "main",
    },
    content: {
      FEATURE_ENABLED: true,
      API_TOKEN_FILE: { secretRef: "local/runtime/api-token" },
    },
  });
  return center;
}

function validAuthorizer() {
  return vi.fn(() =>
    Promise.resolve({
      environment: "production",
      deploymentId: "deployment-1",
      instanceId: "instance-1",
      providerId: "provider-authoritative",
    }),
  );
}

function latestUrl(instanceId = "instance-1"): string {
  return `/api/v1/runtime-config/deployments/deployment-1/instances/${instanceId}/latest?environment=production&configGroup=runtime.e2e&dataId=main`;
}

function ackUrl(targetRevisionId: string): string {
  return `/api/v1/runtime-config/deployments/deployment-1/instances/instance-1/revisions/${targetRevisionId}/acks?environment=production&configGroup=runtime.e2e&dataId=main`;
}

function field(
  name: string,
  applyMode: "hot_reload" | "restart_required" | "immutable",
  secret = false,
  overrideMode: "inheritable" | "forbidden" = "inheritable",
) {
  return {
    path: `/${name}`,
    displayName: name,
    description: `${name} setting`,
    applyMode,
    required: name !== "API_TOKEN_FILE",
    secret,
    overridePolicy:
      overrideMode === "forbidden"
        ? { mode: "forbidden" as const }
        : {
            mode: "inheritable" as const,
            allowedTargetTypes: ["runtime_deployment", "runtime_instance"] as const,
          },
  };
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
