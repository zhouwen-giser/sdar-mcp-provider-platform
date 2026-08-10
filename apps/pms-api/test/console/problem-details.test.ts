import { PmsRepositoryError } from "../../../../packages/pms-domain/src/index.js";
import type { ProviderManagementService } from "../../../../packages/pms-application/src/index.js";
import { describe, expect, it, vi } from "vitest";
import { createConsoleTestApp, WRITE_HEADERS } from "./helpers.js";

describe("Console ProblemDetails", () => {
  it("maps request validation errors independently from the legacy envelope", async () => {
    const { app } = createConsoleTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/console/v1/providers",
      headers: WRITE_HEADERS,
      payload: {
        providerId: "provider-1",
        providerTypeId: "isr.vehicle.ugv",
        unknown: true,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({
      status: 400,
      code: "INVALID_REQUEST",
      correlationId: "corr-1",
    });
    expect(response.json()).not.toHaveProperty("error");
    await app.close();
  });

  it("maps existing concurrency errors to frozen codes", async () => {
    const updateProviderStatus = vi.fn(async () => {
      throw new PmsRepositoryError(
        "OPTIMISTIC_CONCURRENCY_CONFLICT",
        "The entity changed; reload and retry",
      );
    });
    const { app } = createConsoleTestApp({
      management: {
        listProviderTypes: vi.fn(async () => ({ items: [] })),
        getProviderType: vi.fn(),
        listProviders: vi.fn(async () => ({ items: [] })),
        createProvider: vi.fn(),
        getProvider: vi.fn(),
        updateProviderStatus,
        listResources: vi.fn(async () => ({ items: [] })),
        createResource: vi.fn(),
        getResource: vi.fn(),
        updateResourceStatus: vi.fn(),
        listProviderResources: vi.fn(async () => []),
        bindResource: vi.fn(),
        unbindResource: vi.fn(),
      } as unknown as ProviderManagementService,
    });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/console/v1/providers/provider-1/status",
      headers: WRITE_HEADERS,
      payload: { status: "active", expectedUpdatedAt: "2026-07-30T00:00:00.000Z" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "OPTIMISTIC_CONCURRENCY_CONFLICT" });
    await app.close();
  });

  it.each([
    ["Error", new Error("database password must never escape")],
    ["TypeError", new TypeError("internal type detail must never escape")],
    ["RangeError", new RangeError("internal range detail must never escape")],
  ])("redacts unexpected %s failures as INTERNAL_ERROR", async (_name, failure) => {
    const { app } = createConsoleTestApp({
      management: {
        listProviderTypes: vi.fn(async () => {
          throw failure;
        }),
      } as unknown as ProviderManagementService,
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/console/v1/provider-types",
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      code: "INTERNAL_ERROR",
      detail: "An internal error occurred",
    });
    expect(response.body).not.toContain(failure.message);
    await app.close();
  });
});
