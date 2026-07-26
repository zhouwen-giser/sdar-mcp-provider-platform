import { describe, expect, it } from "vitest";
import { RuntimeObservabilityConfigurationDefinition } from "../../../packages/runtime-configuration-contract/src/runtime/observability.js";
import { ConfigurationCenter } from "../../../packages/configuration-center/src/index.js";
import { createPmsApi, pmsOpenApiDocument } from "../src/index.js";

describe("PMS configuration draft API", () => {
  it("creates, validates, and previews a shared-contract draft", async () => {
    const app = createPmsApi({
      configurationCenter: new ConfigurationCenter([RuntimeObservabilityConfigurationDefinition]),
    });
    const headers = { "x-actor-id": "admin-1", "x-correlation-id": "config-flow" };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/config-drafts",
      headers,
      payload: {
        draftId: "otel-production",
        definitionId: "runtime.observability",
        environment: "production",
        targetType: "runtime_deployment",
        targetId: "deployment-1",
        configGroup: "runtime.observability",
        dataId: "main",
        content: { LOG_LEVEL: "debug", OTEL_ENABLED: true },
      },
    });
    expect(created.statusCode).toBe(201);

    const validated = await app.inject({
      method: "POST",
      url: "/api/v1/config-drafts/otel-production/validate",
      headers,
    });
    expect(validated.statusCode).toBe(200);
    expect(validated.json()).toMatchObject({ status: "validated", applyMode: "hot_reload" });

    const preview = await app.inject({
      method: "GET",
      url: "/api/v1/config-drafts/otel-production/effective",
    });
    expect(preview.json()).toMatchObject({
      valid: true,
      content: { LOG_LEVEL: "debug", OTEL_ENABLED: true },
    });
    await app.close();
  });

  it("never reflects plaintext submitted to a SecretRef field", async () => {
    const app = createPmsApi({
      configurationCenter: new ConfigurationCenter([RuntimeObservabilityConfigurationDefinition]),
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/config-drafts",
      headers: { "x-actor-id": "admin-1" },
      payload: {
        draftId: "unsafe",
        definitionId: "runtime.observability",
        environment: "production",
        targetType: "runtime_deployment",
        targetId: "deployment-1",
        configGroup: "runtime.observability",
        dataId: "main",
        content: { OTEL_EXPORTER_OTLP_KEY_PATH: "do-not-return-this-value" },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("do-not-return-this-value");
    expect(response.json()).toMatchObject({ error: { code: "CONFIGURATION_INPUT_INVALID" } });
    await app.close();
  });

  it("requires actor context for draft writes and documents all draft routes", async () => {
    const app = createPmsApi({
      configurationCenter: new ConfigurationCenter([RuntimeObservabilityConfigurationDefinition]),
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/config-drafts",
      payload: {
        draftId: "no-actor",
        definitionId: "runtime.observability",
        environment: "test",
        targetType: "runtime_deployment",
        targetId: "deployment-1",
        configGroup: "runtime.observability",
        dataId: "main",
        content: {},
      },
    });
    expect(response.statusCode).toBe(400);

    const document = pmsOpenApiDocument() as { paths: Readonly<Record<string, unknown>> };
    for (const path of [
      "/api/v1/config-drafts",
      "/api/v1/config-drafts/{draftId}",
      "/api/v1/config-drafts/{draftId}/validate",
      "/api/v1/config-drafts/{draftId}/effective",
    ]) {
      expect(document.paths).toHaveProperty(path);
    }
    await app.close();
  });
});
