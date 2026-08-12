import type {
  AuditEventDto,
  ConfigurationDraftDto,
  ConfigurationPublicationResultDto,
  EffectiveConfigurationPreviewDto,
  ProviderDto,
  ProviderPackageDto,
  ProviderResourceBindingDto,
  ProviderTypeDto,
  RegistryDiffDto,
  RegistrySnapshotDto,
  ResourceDto,
  RuntimeDeploymentDto,
  RuntimeDeploymentIntentDto,
  RuntimeProcessDto,
} from "../../api/types.js";
import type {
  AuditListFilters,
  GatewayBundle,
  GatewayContext,
  Page,
  ProviderListFilters,
  ProviderPackageListFilters,
  ProviderTypeListFilters,
  ResourceListFilters,
  RuntimeDeploymentListFilters,
  RuntimeProcessListFilters,
  ScenarioController,
} from "../contracts/index.js";
import type { ProductScenario } from "../../scenarios/types.js";
import {
  ConsoleHttpClient,
  encodePathSegment,
  type ConsoleHttpClientOptions,
  type ConsoleQuery,
} from "./http-client.js";

const apiScenarioController: ScenarioController = {
  current: () => "healthy" as ProductScenario,
  set: () => undefined,
  revision: () => 0,
  subscribe: () => () => undefined,
};

export function createHttpGateways(options: ConsoleHttpClientOptions = {}): GatewayBundle {
  const client = new ConsoleHttpClient(options);
  return {
    providers: {
      listProviderPackages: (context, filters) =>
        get<Page<ProviderPackageDto>>(client, "/provider-packages", context, filters),
      getProviderPackage: (packageId, version, context) =>
        get<ProviderPackageDto>(
          client,
          `/provider-packages/${encodePathSegment(packageId)}`,
          context,
          { version },
        ),
      listProviderTypes: (context, filters) =>
        get<Page<ProviderTypeDto>>(client, "/provider-types", context, filters),
      getProviderType: (providerTypeId, context) =>
        get<ProviderTypeDto>(
          client,
          `/provider-types/${encodePathSegment(providerTypeId)}`,
          context,
        ),
      listProviders: (context, filters) =>
        get<Page<ProviderDto>>(client, "/providers", context, filters),
      createProvider: (input, context) =>
        write<ProviderDto>(client, "POST", "/providers", input, context),
      getProvider: (providerId, context) =>
        get<ProviderDto>(client, `/providers/${encodePathSegment(providerId)}`, context),
      updateProviderStatus: (providerId, input, context) =>
        write<ProviderDto>(
          client,
          "PATCH",
          `/providers/${encodePathSegment(providerId)}/status`,
          input,
          context,
        ),
    },
    resources: {
      listResources: (environment, context, filters) =>
        get<Page<ResourceDto>>(client, "/resources", context, { environment, ...filters }),
      createResource: (input, context) =>
        write<ResourceDto>(client, "POST", "/resources", input, context),
      getResource: (environment, resourceId, context) =>
        get<ResourceDto>(
          client,
          `/resources/${encodePathSegment(environment)}/${encodePathSegment(resourceId)}`,
          context,
        ),
      updateResourceStatus: (environment, resourceId, input, context) =>
        write<ResourceDto>(
          client,
          "PATCH",
          `/resources/${encodePathSegment(environment)}/${encodePathSegment(resourceId)}/status`,
          input,
          context,
        ),
      listBindings: (providerId, context) =>
        get<Page<ProviderResourceBindingDto>>(
          client,
          `/providers/${encodePathSegment(providerId)}/resource-bindings`,
          context,
        ),
      bind: (providerId, input, context) =>
        write<ProviderResourceBindingDto>(
          client,
          "POST",
          `/providers/${encodePathSegment(providerId)}/resource-bindings`,
          input,
          context,
        ),
      unbind: (providerId, environment, resourceId, context) =>
        client.request<undefined>({
          method: "DELETE",
          path: `/providers/${encodePathSegment(providerId)}/resource-bindings/${encodePathSegment(environment)}/${encodePathSegment(resourceId)}`,
          ...(context === undefined ? {} : { context }),
        }),
    },
    configuration: {
      createDraft: (input, context) =>
        write<ConfigurationDraftDto>(client, "POST", "/configuration-drafts", input, context),
      getDraft: (draftId, context) =>
        get<ConfigurationDraftDto>(
          client,
          `/configuration-drafts/${encodePathSegment(draftId)}`,
          context,
        ),
      updateDraft: (draftId, input, context) =>
        write<ConfigurationDraftDto>(
          client,
          "PATCH",
          `/configuration-drafts/${encodePathSegment(draftId)}`,
          input,
          context,
        ),
      validateDraft: (draftId, context) =>
        write<ConfigurationDraftDto>(
          client,
          "POST",
          `/configuration-drafts/${encodePathSegment(draftId)}/validate`,
          undefined,
          context,
        ),
      previewDraft: (draftId, context) =>
        get<EffectiveConfigurationPreviewDto>(
          client,
          `/configuration-drafts/${encodePathSegment(draftId)}/effective`,
          context,
        ),
      publishDraft: (draftId, input, context) =>
        write<ConfigurationPublicationResultDto>(
          client,
          "POST",
          `/configuration-drafts/${encodePathSegment(draftId)}/publish`,
          input,
          context,
        ),
      rollbackDraft: (draftId, input, context) =>
        write<ConfigurationPublicationResultDto>(
          client,
          "POST",
          `/configuration-drafts/${encodePathSegment(draftId)}/rollback`,
          input,
          context,
        ),
    },
    runtime: {
      listDeployments: (providerId, context, filters) =>
        get<Page<RuntimeDeploymentDto>>(client, "/runtime-deployments", context, {
          providerId,
          ...filters,
        }),
      createDeployment: (input, context) =>
        write<RuntimeDeploymentIntentDto>(client, "POST", "/runtime-deployments", input, context),
      getDeployment: (providerId, deploymentId, context) =>
        get<RuntimeDeploymentDto>(
          client,
          `/runtime-deployments/${encodePathSegment(deploymentId)}`,
          context,
          { providerId },
        ),
      startDeployment: (deploymentId, input, context) =>
        runtimeCommand(client, deploymentId, "start", input, context),
      stopDeployment: (deploymentId, input, context) =>
        runtimeCommand(client, deploymentId, "stop", input, context),
      restartDeployment: (deploymentId, input, context) =>
        runtimeCommand(client, deploymentId, "restart", input, context),
      scaleDeployment: (deploymentId, input, context) =>
        runtimeCommand(client, deploymentId, "scale", input, context),
      reconcileDeployment: (deploymentId, input, context) =>
        runtimeCommand(client, deploymentId, "reconcile", input, context),
      listProcesses: (providerId, deploymentId, context, filters) =>
        get<Page<RuntimeProcessDto>>(client, "/runtime-processes", context, {
          providerId,
          deploymentId,
          ...filters,
        }),
      getProcess: (providerId, instanceId, context) =>
        get<RuntimeProcessDto>(
          client,
          `/runtime-processes/${encodePathSegment(instanceId)}`,
          context,
          { providerId },
        ),
    },
    registry: {
      latest: (environment, context) =>
        get<RegistrySnapshotDto>(
          client,
          `/registry/${encodePathSegment(environment)}/latest`,
          context,
        ),
      history: (environment, context, filters) =>
        get<Page<RegistrySnapshotDto>>(
          client,
          `/registry/${encodePathSegment(environment)}/history`,
          context,
          filters,
        ),
      diff: (environment, fromRevision, toRevision, context) =>
        get<RegistryDiffDto>(client, `/registry/${encodePathSegment(environment)}/diff`, context, {
          fromRevision,
          toRevision,
        }),
    },
    audit: {
      list: (filters, context) =>
        get<Page<AuditEventDto>>(client, "/audit-events", context, filters),
    },
    scenarios: apiScenarioController,
  };
}

function get<T>(
  client: ConsoleHttpClient,
  path: string,
  context?: GatewayContext,
  query?:
    | ConsoleQuery
    | ProviderPackageListFilters
    | ProviderTypeListFilters
    | ProviderListFilters
    | ResourceListFilters
    | RuntimeDeploymentListFilters
    | RuntimeProcessListFilters
    | AuditListFilters,
): Promise<T> {
  return client.request<T>({
    method: "GET",
    path,
    ...(context === undefined ? {} : { context }),
    ...(query === undefined ? {} : { query: query as ConsoleQuery }),
  });
}

function write<T>(
  client: ConsoleHttpClient,
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
  context?: GatewayContext,
): Promise<T> {
  return client.request<T>({
    method,
    path,
    body,
    ...(context === undefined ? {} : { context }),
  });
}

function runtimeCommand(
  client: ConsoleHttpClient,
  deploymentId: string,
  action: "start" | "stop" | "restart" | "scale" | "reconcile",
  input: unknown,
  context?: GatewayContext,
): Promise<RuntimeDeploymentIntentDto> {
  return write<RuntimeDeploymentIntentDto>(
    client,
    "POST",
    `/runtime-deployments/${encodePathSegment(deploymentId)}/${action}`,
    input,
    context,
  );
}
