import { describe, expect, it } from "vitest";
import {
  createProviderResource,
  PROVIDER_RUNTIME_SERVICE_NAME,
} from "../../packages/observability/src/index.js";

describe("Provider telemetry resource", () => {
  it("uses the required stable resource attributes", () => {
    const resource = createProviderResource({
      serviceVersion: "1.1.0",
      instanceId: "runtime-a",
      deploymentEnvironment: "staging",
      providerId: "provider-a",
      providerVersion: "2.3.4",
    });

    expect(resource.attributes).toMatchObject({
      "service.name": PROVIDER_RUNTIME_SERVICE_NAME,
      "service.version": "1.1.0",
      "service.instance.id": "runtime-a",
      "deployment.environment.name": "staging",
      "sdar.provider.id": "provider-a",
      "sdar.provider.version": "2.3.4",
    });
  });
});
