import { resourceFromAttributes } from "@opentelemetry/resources";

export const PROVIDER_RUNTIME_SERVICE_NAME = "sdar-mcp-tasks-provider-runtime";

export interface ProviderResourceInput {
  serviceVersion: string;
  instanceId: string;
  deploymentEnvironment: string;
  providerId: string;
  providerVersion: string;
}

export function createProviderResource(input: ProviderResourceInput) {
  return resourceFromAttributes({
    "service.name": PROVIDER_RUNTIME_SERVICE_NAME,
    "service.version": input.serviceVersion,
    "service.instance.id": input.instanceId,
    "deployment.environment.name": input.deploymentEnvironment,
    "sdar.provider.id": input.providerId,
    "sdar.provider.version": input.providerVersion,
  });
}
