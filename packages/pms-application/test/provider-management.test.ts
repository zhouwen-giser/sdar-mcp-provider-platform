import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresPmsUnitOfWork,
  runPmsMigrations,
} from "../../pms-persistence-postgres/src/index.js";
import { ProviderManagementService } from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const audit = { actorId: "admin-1", correlationId: "management-test" };

describe("Provider management application", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `pms_management_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  let service: ProviderManagementService;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    service = new ProviderManagementService(new PostgresPmsUnitOfWork(pool));
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("creates ProviderType, vendor-managed Providers, Resources, and true N:N bindings", async () => {
    await service.createProviderType(
      { providerTypeId: "isr.vehicle.managed", displayName: "Managed vehicles" },
      audit,
    );
    const firstProvider = await service.createProvider(
      { providerId: "provider-1", providerTypeId: "isr.vehicle.managed" },
      audit,
    );
    const secondProvider = await service.createProvider(
      { providerId: "provider-2", providerTypeId: "isr.vehicle.managed" },
      audit,
    );
    await service.createResource(
      {
        environment: "production",
        resourceId: "vehicle:1",
        resourceType: "vehicle",
        metadata: {},
      },
      audit,
    );
    await service.createResource(
      {
        environment: "production",
        resourceId: "vehicle:2",
        resourceType: "vehicle",
        metadata: {},
      },
      audit,
    );
    await service.bindResource(
      { providerId: "provider-1", environment: "production", resourceId: "vehicle:1" },
      audit,
    );
    await service.bindResource(
      { providerId: "provider-1", environment: "production", resourceId: "vehicle:2" },
      audit,
    );
    await service.bindResource(
      { providerId: "provider-2", environment: "production", resourceId: "vehicle:1" },
      audit,
    );

    expect(firstProvider).toMatchObject({ hostingMode: "vendor_managed", status: "draft" });
    expect(secondProvider).not.toHaveProperty("resourceId");
    expect(await service.listProviderResources("provider-1")).toHaveLength(2);
    expect(await service.listProviderResources("provider-2")).toHaveLength(1);
    expect(await count("audit")).toBe(8);
  });

  it("enforces lifecycle and optimistic status preconditions", async () => {
    const provider = await service.getProvider("provider-1");
    if (provider.updatedAt === undefined) throw new Error("PROVIDER_TOKEN_MISSING");
    const active = await service.updateProviderStatus(
      "provider-1",
      "active",
      provider.updatedAt,
      audit,
    );
    expect(active.status).toBe("active");
    expect(active.updatedAt?.getTime()).toBeGreaterThan(provider.updatedAt.getTime());
    if (active.updatedAt === undefined) throw new Error("UPDATED_PROVIDER_TOKEN_MISSING");
    await expect(
      service.updateProviderStatus("provider-1", "draft", active.updatedAt, audit),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });

    const resource = await service.getResource({
      environment: "production",
      resourceId: "vehicle:2",
    });
    if (resource.updatedAt === undefined) throw new Error("RESOURCE_TOKEN_MISSING");
    const metadataUpdated = await service.updateResourceMetadata(
      {
        environment: "production",
        resourceId: "vehicle:2",
        metadata: { runtimeAuthority: "direct_container", registryAuthority: "pms_worker" },
        expectedUpdatedAt: resource.updatedAt,
      },
      audit,
    );
    expect(metadataUpdated.metadata).toEqual({
      runtimeAuthority: "direct_container",
      registryAuthority: "pms_worker",
    });
    if (metadataUpdated.updatedAt === undefined) throw new Error("UPDATED_RESOURCE_TOKEN_MISSING");
    await expect(
      service.updateResourceMetadata(
        {
          environment: "production",
          resourceId: "vehicle:2",
          metadata: { registryAuthority: "not_configured" },
          expectedUpdatedAt: resource.updatedAt,
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: "OPTIMISTIC_CONCURRENCY_CONFLICT" });
    const retired = await service.updateResourceStatus(
      { environment: "production", resourceId: "vehicle:2" },
      "retired",
      metadataUpdated.updatedAt,
      audit,
    );
    if (retired.updatedAt === undefined) throw new Error("UPDATED_RESOURCE_TOKEN_MISSING");
    await expect(
      service.updateResourceStatus(
        { environment: "production", resourceId: "vehicle:2" },
        "available",
        retired.updatedAt,
        audit,
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });

    const type = await service.getProviderType("isr.vehicle.managed");
    if (type.updatedAt === undefined) throw new Error("PROVIDER_TYPE_TOKEN_MISSING");
    expect(
      (
        await service.updateProviderTypeStatus(
          "isr.vehicle.managed",
          "deprecated",
          type.updatedAt,
          audit,
        )
      ).status,
    ).toBe("deprecated");
  });

  it("rolls back and emits no Audit when a referenced ProviderType is missing", async () => {
    const before = await count("audit");
    await expect(
      service.createProvider(
        { providerId: "orphan-provider", providerTypeId: "missing.provider_type" },
        audit,
      ),
    ).rejects.toMatchObject({ code: "ENTITY_NOT_FOUND" });

    expect(await count("provider")).toBe(2);
    expect(await count("audit")).toBe(before);
  });

  async function count(table: "audit" | "provider"): Promise<number> {
    const result = await pool.query<{ count: string }>(`SELECT count(*) FROM ${table}`);
    return Number(result.rows[0]?.count ?? 0);
  }
});

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
