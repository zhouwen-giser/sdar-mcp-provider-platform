import { describe, expect, it, vi } from "vitest";
import type { ProviderManagementService } from "../../../packages/pms-application/src/index.js";
import { createPmsApi, pmsOpenApiDocument } from "../src/index.js";

describe("Provider and Resource management routes", () => {
  it("requires an actor context for every write", async () => {
    const createProviderType = vi.fn();
    const app = createPmsApi({
      management: management({ createProviderType }),
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/provider-types",
      payload: { providerTypeId: "isr.vehicle.ugv", displayName: "UGV" },
      headers: { "x-request-id": "write-1", "x-correlation-id": "correlation-1" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_DOMAIN_VALUE" } });
    expect(createProviderType).not.toHaveBeenCalled();
    await app.close();
  });

  it("creates a vendor-managed Provider without a single resource field", async () => {
    const createProvider = vi.fn(() =>
      Promise.resolve({
        providerId: "provider-1",
        providerTypeId: "isr.vehicle.ugv",
        hostingMode: "vendor_managed",
        status: "draft",
        updatedAt: "2026-07-26T00:00:00.000Z",
      }),
    );
    const app = createPmsApi({ management: management({ createProvider }) });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/providers",
      payload: { providerId: "provider-1", providerTypeId: "isr.vehicle.ugv" },
      headers: { "x-actor-id": "admin-1", "x-correlation-id": "correlation-2" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      providerId: "provider-1",
      hostingMode: "vendor_managed",
    });
    expect(response.json()).not.toHaveProperty("resourceId");
    expect(createProvider).toHaveBeenCalledWith(
      { providerId: "provider-1", providerTypeId: "isr.vehicle.ugv" },
      { actorId: "admin-1", correlationId: "correlation-2" },
    );
    await app.close();
  });

  it("routes Resource creation and many-to-many bind/list/unbind", async () => {
    const createResource = vi.fn(() =>
      Promise.resolve({
        environment: "production",
        resourceId: "vehicle:1",
        resourceType: "vehicle",
        metadata: {},
        status: "available",
      }),
    );
    const bindResource = vi.fn(() =>
      Promise.resolve({
        providerId: "provider-1",
        environment: "production",
        resourceId: "vehicle:1",
        boundAt: new Date("2026-07-26T00:00:00.000Z"),
      }),
    );
    const listProviderResources = vi.fn(() =>
      Promise.resolve([
        {
          providerId: "provider-1",
          environment: "production",
          resourceId: "vehicle:1",
          boundAt: new Date("2026-07-26T00:00:00.000Z"),
        },
      ]),
    );
    const unbindResource = vi.fn(() => Promise.resolve());
    const app = createPmsApi({
      management: management({
        createResource,
        bindResource,
        listProviderResources,
        unbindResource,
      }),
    });
    const headers = { "x-actor-id": "admin-1", "x-correlation-id": "binding-flow" };

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/resources",
          headers,
          payload: {
            environment: "production",
            resourceId: "vehicle:1",
            resourceType: "vehicle",
          },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/providers/provider-1/resource-bindings",
          headers,
          payload: { environment: "production", resourceId: "vehicle:1" },
        })
      ).statusCode,
    ).toBe(201);
    const bindings = await app.inject({
      method: "GET",
      url: "/api/v1/providers/provider-1/resource-bindings",
    });
    expect(bindings.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/v1/providers/provider-1/resource-bindings/production/vehicle:1",
          headers,
        })
      ).statusCode,
    ).toBe(204);
    expect(bindResource).toHaveBeenCalledOnce();
    expect(unbindResource).toHaveBeenCalledOnce();
    await app.close();
  });

  it("validates lifecycle update timestamps before the application call", async () => {
    const updateProviderStatus = vi.fn();
    const app = createPmsApi({ management: management({ updateProviderStatus }) });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/providers/provider-1/status",
      headers: { "x-actor-id": "admin-1", "x-correlation-id": "status-1" },
      payload: { status: "active", expectedUpdatedAt: "not-a-time" },
    });

    expect(response.statusCode).toBe(400);
    expect(updateProviderStatus).not.toHaveBeenCalled();
    await app.close();
  });

  it("documents management collections and N:N bindings in OpenAPI", () => {
    const document = pmsOpenApiDocument() as {
      paths: Readonly<Record<string, unknown>>;
    };
    for (const path of [
      "/api/v1/provider-types",
      "/api/v1/providers",
      "/api/v1/resources",
      "/api/v1/providers/{providerId}/resource-bindings",
    ]) {
      expect(document.paths).toHaveProperty(path);
    }
  });
});

function management(overrides: Readonly<Record<string, unknown>>): ProviderManagementService {
  return overrides as unknown as ProviderManagementService;
}
