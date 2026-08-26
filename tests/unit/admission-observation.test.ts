import { describe, expect, it } from "vitest";
import { DevelopmentAdmissionObservationStore } from "../../apps/runtime/src/admission-observation.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { createRuntime } from "../../apps/runtime/src/runtime.js";

const rawResponse = {
  jsonrpc: "2.0",
  id: "a2a-admission-1",
  result: {
    resultType: "task",
    taskId: "provider-task-1",
    status: "working",
    _meta: {
      "io.sdar/providerIdentity": {
        profileVersion: "1.0",
        providerId: "provider-1",
        providerInstanceId: "provider-instance-1",
      },
      "io.sdar/taskExecution": {
        profileVersion: "1.0",
        runtimeRevision: "4",
        providerRevision: "9",
      },
    },
  },
};

describe("development admission observation", () => {
  it("starts the observation route in the no-auth development profile", async () => {
    const runtime = createRuntime(
      loadRuntimeConfig({
        RUNTIME_ENV: "development",
        AUTH_MODE: "development",
        PROVIDER_ID: "mock-provider",
        DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
        ADAPTER_ENDPOINT: "127.0.0.1:1",
        PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
        BUSINESS_EVENTS_ENABLED: "false",
      }),
    );
    try {
      await expect(
        runtime.app.inject({ method: "GET", url: "/health/live" }),
      ).resolves.toMatchObject({
        statusCode: 200,
      });
      const observation = await runtime.app.inject({
        method: "GET",
        url: "/development/admission-observations/not-yet-admitted",
      });
      expect(observation.statusCode).toBe(404);
      expect(observation.json()).toEqual({ error: "admission_observation_not_found" });
    } finally {
      await runtime.app.close();
    }
  });

  it("keeps the raw response and exposes only Provider-local committed/configured identities", () => {
    const store = new DevelopmentAdmissionObservationStore(
      { deploymentId: "provider-deployment-1", instanceId: "replacement-process-instance" },
      2,
      () => new Date("2026-08-26T00:00:00.000Z"),
    );
    store.record({
      rawResponse,
      localIdentity: {
        taskId: "provider-task-1",
        providerId: "provider-1",
        providerInstanceId: "provider-instance-1",
        externalExecutionId: "execution-1",
        operationName: "vehicle_navigate",
        runtimeRevision: "4",
        providerRevision: "9",
        correlationId: "correlation-1",
        executionMode: "simulation",
        simulationId: "simulator-1",
      },
    });

    const observation = store.get("provider-task-1");
    expect(observation).toMatchObject({
      rawResponse,
      localIdentities: {
        taskId: "provider-task-1",
        providerId: "provider-1",
        externalExecutionId: "execution-1",
        deploymentId: "provider-deployment-1",
        instanceId: "provider-instance-1",
      },
      revisions: { runtimeRevision: "4", providerRevision: "9" },
      correlation: {
        correlationId: "correlation-1",
        executionMode: "simulation",
        simulationId: "simulator-1",
      },
      authority: {
        taskAndExecution: "provider_committed_postgres",
        instance: "provider_committed_postgres",
        originClaims: "non_authoritative",
      },
      unresolvedContractIdentities: ["providerSource", "server"],
    });
    expect(observation?.localIdentities).not.toHaveProperty("providerSource");
    expect(observation?.localIdentities).not.toHaveProperty("server");
  });

  it("rejects a raw response that disagrees with committed identity or revision", () => {
    const store = new DevelopmentAdmissionObservationStore(null);
    expect(() =>
      store.record({
        rawResponse,
        localIdentity: {
          taskId: "different-task",
          providerId: "provider-1",
          providerInstanceId: "provider-instance-1",
          externalExecutionId: null,
          operationName: "vehicle_navigate",
          runtimeRevision: "4",
          providerRevision: "9",
          correlationId: null,
          executionMode: "simulation",
          simulationId: "simulator-1",
        },
      }),
    ).toThrow("DEVELOPMENT_ADMISSION_OBSERVATION_IDENTITY_MISMATCH");
  });
});
