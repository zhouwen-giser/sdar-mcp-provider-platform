import { describe, expect, it, vi } from "vitest";
import { PmsWebApiClient } from "../src/api-client.js";

describe("PMS Web API client", () => {
  it("projects package qualification separately and drops all unknown secret fields", async () => {
    const client = new PmsWebApiClient({
      fetch: response({
        items: [
          {
            packageId: "builtin.isr.vehicle.ugv",
            packageVersion: "1.0.0",
            providerType: "isr.vehicle.ugv",
            hostingModes: ["vendor_managed"],
            compatibleRuntimeVersion: "2.0.0",
            protocolMode: "frozen_v1",
            qualification: { componentStatus: "passed", realResourceStatus: "pending" },
            secretRef: "local/provider/token",
            databaseUrl: "postgresql://secret",
            pm2Name: "sdar-private",
          },
        ],
      }),
    });

    const packages = await client.packages();

    expect(packages).toEqual([
      {
        packageId: "builtin.isr.vehicle.ugv",
        packageVersion: "1.0.0",
        providerType: "isr.vehicle.ugv",
        hostingModes: ["vendor_managed"],
        compatibleRuntimeVersion: "2.0.0",
        protocolMode: "frozen_v1",
        qualification: { componentStatus: "passed", realResourceStatus: "pending" },
      },
    ]);
    expect(JSON.stringify(packages)).not.toContain("secret");
    expect(JSON.stringify(packages)).not.toContain("pm2");
  });

  it("creates vendor-managed Providers with actor context and no credential fields", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          providerId: "provider-a",
          providerTypeId: "test.provider",
          hostingMode: "vendor_managed",
          status: "draft",
        }),
      ),
    );
    const client = new PmsWebApiClient({
      authorization: () => "Bearer session-token",
      actorId: () => "admin-1",
      fetch: fetchMock,
    });

    await client.createProvider({
      providerId: "provider-a",
      providerTypeId: "test.provider",
      hostingMode: "vendor_managed",
    });

    const call = fetchMock.mock.calls[0];
    const init = call?.[1];
    const headers = new Headers(init?.headers);
    expect(call?.[0]).toBe("/api/v1/providers");
    expect(init?.method).toBe("POST");
    expect(headers.get("authorization")).toBe("Bearer session-token");
    expect(headers.get("x-actor-id")).toBe("admin-1");
    expect(init?.body).toBe(
      JSON.stringify({
        providerId: "provider-a",
        providerTypeId: "test.provider",
        hostingMode: "vendor_managed",
      }),
    );
  });

  it("fails closed when the PMS response is not a public projection", async () => {
    const client = new PmsWebApiClient({
      fetch: response({ items: [{ providerId: "provider-a", password: "do-not-render" }] }),
    });
    await expect(client.providers()).rejects.toMatchObject({
      code: "PMS_WEB_RESPONSE_INVALID",
      status: 502,
    });
  });

  it("projects Runtime status without PM2 names or environment internals", async () => {
    const client = new PmsWebApiClient({
      fetch: response({
        items: [
          {
            instanceId: "instance-1",
            deploymentId: "deployment-1",
            pm2Name: "sdar-runtime-private",
            pid: 1201,
            port: 3101,
            processState: "online",
            livenessState: "live",
            readinessState: "not_ready",
            observedHealth: "NOT_READY",
            readyForActive: false,
            healthReasonCode: "READINESS_FAILED",
            configState: "restart_required",
            configRevision: 4,
            runtimeVersion: "0.1.0",
            restartCount: 1,
          },
        ],
      }),
    });

    const processes = await client.runtimeProcesses("provider-1", "deployment-1");

    expect(processes.items[0]).toMatchObject({
      processState: "online",
      readinessState: "not_ready",
      observedHealth: "NOT_READY",
      readyForActive: false,
      configState: "restart_required",
    });
    expect(JSON.stringify(processes)).not.toContain("pm2Name");
    expect(JSON.stringify(processes)).not.toContain('"pid"');
  });

  it("sends revision-guarded Runtime actions with actor context", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          operationId: "operation-restart",
          deployment: {
            deploymentId: "deployment-1",
            providerId: "provider-1",
            environment: "production",
            desiredState: "running",
            desiredReplicas: 1,
            runtimeVersion: "0.1.0",
            status: "REQUESTED",
            desiredRevision: 4,
            observedRevision: 3,
          },
        }),
      ),
    );
    const client = new PmsWebApiClient({
      actorId: () => "admin-1",
      fetch: fetchMock,
    });

    await client.commandRuntime("deployment-1", "restart", "provider-1", 3);

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/v1/runtime-deployments/deployment-1/restart");
    expect(call?.[1]?.body).toBe(
      JSON.stringify({ providerId: "provider-1", expectedDesiredRevision: 3 }),
    );
    expect(new Headers(call?.[1]?.headers).get("x-actor-id")).toBe("admin-1");
  });
});

function response(body: unknown): typeof fetch {
  return () => Promise.resolve(jsonResponse(body));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
