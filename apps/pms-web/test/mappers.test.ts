import { describe, expect, it } from "vitest";
import provider from "../src/api/schemas/examples/provider.json";
import resource from "../src/api/schemas/examples/resource.json";
import deployment from "../src/api/schemas/examples/runtime-deployment.json";
import process from "../src/api/schemas/examples/runtime-process.json";
import draft from "../src/api/schemas/examples/configuration-draft.json";
import { mapConfigurationDraft, mapProvider, mapResource, mapRuntimeDeployment, mapRuntimeProcess } from "../src/mappers/contract-mappers.js";
import type { ConfigurationDraftDto, ProviderDto, ResourceDto, RuntimeDeploymentDto, RuntimeProcessDto } from "../src/api/types.js";

describe("contract DTO to view model mappers", () => {
  it("preserves domain-specific status types", () => {
    expect(mapProvider(provider as ProviderDto).status).toBe(provider.status);
    expect(mapResource(resource as ResourceDto).status).toBe(resource.status);
    expect(mapRuntimeDeployment(deployment as RuntimeDeploymentDto).desiredState).toBe(deployment.desiredState);
    expect(mapRuntimeProcess(process as RuntimeProcessDto).registrationState).toBe(process.registrationState);
    expect(mapConfigurationDraft(draft as ConfigurationDraftDto).status).toBe(draft.status);
  });

  it("derives display-only fields without changing contract DTOs", () => {
    const providerView = mapProvider(provider as ProviderDto);
    expect(providerView.packageLabel).toContain("@");
    const resourceView = mapResource(resource as ResourceDto);
    expect(resourceView.displayName.length).toBeGreaterThan(0);
  });
});
