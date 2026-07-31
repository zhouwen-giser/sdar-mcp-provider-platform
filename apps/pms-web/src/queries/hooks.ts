import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGateways } from "../app/providers/app-providers.js";
import { queryKeys } from "./query-keys.js";
import {
  mapAuditEvent,
  mapConfigurationDraft,
  mapProvider,
  mapProviderPackage,
  mapRegistrySnapshot,
  mapResource,
  mapRuntimeDeployment,
  mapRuntimeProcess,
} from "../mappers/contract-mappers.js";
import type { ConfigurationContentDto } from "./query-types.js";
import { useClientWorkspace, useClientWorkspaceStore } from "../client-workspace/context.js";

const context = (signal?: AbortSignal) => ({ signal, correlationId: `corr-web-${Date.now()}`, actorId: "prototype-admin" });
export function useProviderTypes() { const { providers } = useGateways(); return useQuery({ queryKey: queryKeys.providerTypes, queryFn: ({ signal }) => providers.listProviderTypes(context(signal)).then(page => page.items) }); }
export function useProviderPackages() { const { providers } = useGateways(); return useQuery({ queryKey: queryKeys.providerPackages, queryFn: ({ signal }) => providers.listProviderPackages(context(signal)).then(page => page.items.map(mapProviderPackage)) }); }
export function useProviderPackage(id: string, version?: string) { const { providers } = useGateways(); return useQuery({ queryKey: queryKeys.providerPackage(id, version), enabled: id.length > 0, queryFn: ({ signal }) => providers.getProviderPackage(id, version, context(signal)).then(mapProviderPackage) }); }
export function useProviders() { const { providers } = useGateways(); return useQuery({ queryKey: queryKeys.providers, queryFn: ({ signal }) => providers.listProviders(context(signal)).then(page => page.items.map(mapProvider)) }); }
export function useProvider(id: string) { const { providers } = useGateways(); return useQuery({ queryKey: queryKeys.provider(id), enabled: id.length > 0, queryFn: ({ signal }) => providers.getProvider(id, context(signal)).then(mapProvider) }); }
export function useCreateProvider() { const { providers } = useGateways(); const client = useQueryClient(); return useMutation({ mutationFn: (input: { providerId: string; providerTypeId: string; packageId?: string; packageVersion?: string; hostingMode: "vendor_managed" | "platform_managed"; adapterEndpoint?: string }) => providers.createProvider(input, context()), onSuccess: async () => client.invalidateQueries({ queryKey: queryKeys.providers }) }); }
export function useUpdateProviderStatus() { const { providers } = useGateways(); const client = useQueryClient(); return useMutation({ mutationFn: (input: { providerId: string; status: "draft" | "active" | "degraded" | "disabled" | "retired"; expectedUpdatedAt: string }) => providers.updateProviderStatus(input.providerId, { status: input.status, expectedUpdatedAt: input.expectedUpdatedAt }, context()), onSuccess: async (_, input) => { await Promise.all([client.invalidateQueries({ queryKey: queryKeys.providers }), client.invalidateQueries({ queryKey: queryKeys.provider(input.providerId) })]); } }); }
export function useResources() { const { resources } = useGateways(); return useQuery({ queryKey: queryKeys.resources, queryFn: ({ signal }) => resources.listResources(context(signal)).then(page => page.items.map(mapResource)) }); }
export function useResource(environment: string, id: string) { const { resources } = useGateways(); return useQuery({ queryKey: queryKeys.resource(environment, id), enabled: id.length > 0, queryFn: ({ signal }) => resources.getResource(environment, id, context(signal)).then(mapResource) }); }
export function useBindings(providerId: string) { const { resources } = useGateways(); return useQuery({ queryKey: queryKeys.bindings(providerId), enabled: providerId.length > 0, queryFn: ({ signal }) => resources.listBindings(providerId, context(signal)).then(page => page.items) }); }
export function useBindResource() { const { resources } = useGateways(); const client = useQueryClient(); return useMutation({ mutationFn: (input: { providerId: string; environment: string; resourceId: string }) => resources.bind(input.providerId, { environment: input.environment, resourceId: input.resourceId }, context()), onSuccess: async (_, input) => client.invalidateQueries({ queryKey: queryKeys.bindings(input.providerId) }) }); }
export function useUnbindResource() { const { resources } = useGateways(); const client = useQueryClient(); return useMutation({ mutationFn: (input: { providerId: string; environment: string; resourceId: string }) => resources.unbind(input.providerId, input.environment, input.resourceId, context()), onSuccess: async (_, input) => client.invalidateQueries({ queryKey: queryKeys.bindings(input.providerId) }) }); }
export function useUpdateResourceStatus() { const { resources } = useGateways(); const client = useQueryClient(); return useMutation({ mutationFn: (input: { environment: string; resourceId: string; status: "available" | "unavailable" | "retired"; expectedUpdatedAt: string }) => resources.updateResourceStatus(input.environment, input.resourceId, { status: input.status, expectedUpdatedAt: input.expectedUpdatedAt }, context()), onSuccess: async (_, input) => { await Promise.all([client.invalidateQueries({ queryKey: queryKeys.resources }), client.invalidateQueries({ queryKey: queryKeys.resource(input.environment, input.resourceId) })]); } }); }
export function useConfigurationDrafts() { const { configuration, scenarios } = useGateways(); const workspace = useClientWorkspace(); const ids = workspace.configurationDraftIds; return useQuery({ queryKey: [...queryKeys.configurationDrafts, ...ids], queryFn: async ({ signal }) => scenarios.current() === "empty" ? [] : Promise.all(ids.map(id => configuration.getDraft(id, context(signal)).then(mapConfigurationDraft))) }); }
export function useConfigurationDraft(id: string) { const { configuration } = useGateways(); return useQuery({ queryKey: queryKeys.configurationDraft(id), enabled: id.length > 0, queryFn: ({ signal }) => configuration.getDraft(id, context(signal)).then(mapConfigurationDraft) }); }
export function useConfigurationPreview(id: string) { const { configuration } = useGateways(); return useQuery({ queryKey: queryKeys.configurationPreview(id), enabled: id.length > 0, queryFn: ({ signal }) => configuration.previewDraft(id, context(signal)) }); }
export function useConfigurationRevisions(id: string) { const workspace = useClientWorkspace(); const revisions = workspace.configurationRevisions.filter(item => item.draftId === id); return useQuery({ queryKey: [...queryKeys.configurationRevisions(id), ...revisions.map(item => item.revisionId)], enabled: id.length > 0, queryFn: async () => revisions }); }
export function useCreateConfigurationDraft() { const { configuration } = useGateways(); const client = useQueryClient(); const workspace = useClientWorkspaceStore(); return useMutation({ mutationFn: (input: { draftId: string; definitionId: string; environment: string; targetType: "environment" | "provider_type" | "provider" | "runtime_deployment" | "runtime_instance" | "collector"; targetId: string; configGroup: string; dataId: string; content: ConfigurationContentDto }) => configuration.createDraft(input, context()), onSuccess: async draft => { workspace.addConfigurationDraftId(draft.draftId); await client.invalidateQueries({ queryKey: queryKeys.configurationDrafts }); } }); }
export function useUpdateConfigurationDraft() { const { configuration } = useGateways(); const client = useQueryClient(); return useMutation({ mutationFn: (input: { draftId: string; expectedVersion: number; content: ConfigurationContentDto }) => configuration.updateDraft(input.draftId, { expectedVersion: input.expectedVersion, content: input.content }, context()), onSuccess: async (_, input) => { await Promise.all([client.invalidateQueries({ queryKey: queryKeys.configurationDrafts }), client.invalidateQueries({ queryKey: queryKeys.configurationDraft(input.draftId) })]); } }); }
export function useValidateConfigurationDraft() { const { configuration } = useGateways(); const client = useQueryClient(); return useMutation({ mutationFn: (draftId: string) => configuration.validateDraft(draftId, context()), onSuccess: async (_, id) => client.invalidateQueries({ queryKey: queryKeys.configurationDraft(id) }) }); }
export function usePublishConfigurationDraft() { const { configuration } = useGateways(); const client = useQueryClient(); const workspace = useClientWorkspaceStore(); return useMutation({ mutationFn: (input: { draftId: string; expectedDraftVersion: number; expectedPublishedRevision: number | null }) => configuration.publishDraft(input.draftId, { expectedDraftVersion: input.expectedDraftVersion, expectedPublishedRevision: input.expectedPublishedRevision }, context()), onSuccess: async (result, input) => { workspace.recordConfigurationRevision(input.draftId, result.revision); await Promise.all([client.invalidateQueries({ queryKey: queryKeys.configurationDraft(input.draftId) }), client.invalidateQueries({ queryKey: queryKeys.configurationRevisions(input.draftId) })]); } }); }
export function useRollbackConfigurationDraft() { const { configuration } = useGateways(); const client = useQueryClient(); const workspace = useClientWorkspaceStore(); return useMutation({ mutationFn: (input: { draftId: string; expectedDraftVersion: number; expectedPublishedRevision: number | null; sourceRevisionId: string }) => configuration.rollbackDraft(input.draftId, { expectedDraftVersion: input.expectedDraftVersion, expectedPublishedRevision: input.expectedPublishedRevision, sourceRevisionId: input.sourceRevisionId }, context()), onSuccess: async (result, input) => { workspace.recordConfigurationRevision(input.draftId, result.revision); await client.invalidateQueries({ queryKey: queryKeys.configurationRevisions(input.draftId) }); } }); }
export function useDeployments() { const { runtime } = useGateways(); return useQuery({ queryKey: queryKeys.deployments, queryFn: ({ signal }) => runtime.listDeployments(context(signal)).then(page => page.items.map(mapRuntimeDeployment)) }); }
export function useDeployment(id: string) { const { runtime } = useGateways(); return useQuery({ queryKey: queryKeys.deployment(id), enabled: id.length > 0, queryFn: ({ signal }) => runtime.getDeployment(id, context(signal)).then(mapRuntimeDeployment) }); }
export function useCreateDeployment() { const { runtime } = useGateways(); const client = useQueryClient(); return useMutation({ mutationFn: (input: { deploymentId: string; providerId: string; environment: string; runtimeVersion: string; databaseProfileId: string; configProfileId: string; adapterEndpoint?: string; desiredReplicas: 0 | 1 }) => runtime.createDeployment(input, context()), onSuccess: async () => client.invalidateQueries({ queryKey: queryKeys.deployments }) }); }
export type RuntimeCommand = "start" | "stop" | "restart" | "reconcile";
export function useRuntimeCommand(command: RuntimeCommand) {
  const { runtime } = useGateways();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { deploymentId: string; providerId: string; expectedDesiredRevision: number }) => {
      const body = { providerId: input.providerId, expectedDesiredRevision: input.expectedDesiredRevision };
      switch (command) {
        case "start": return runtime.startDeployment(input.deploymentId, body, context());
        case "stop": return runtime.stopDeployment(input.deploymentId, body, context());
        case "restart": return runtime.restartDeployment(input.deploymentId, body, context());
        case "reconcile": return runtime.reconcileDeployment(input.deploymentId, body, context());
      }
    },
    onSuccess: async (_, input) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.deployments }),
        client.invalidateQueries({ queryKey: queryKeys.deployment(input.deploymentId) }),
      ]);
    },
  });
}
export function useScaleDeployment() { const { runtime } = useGateways(); const client = useQueryClient(); return useMutation({ mutationFn: (input: { deploymentId: string; providerId: string; expectedDesiredRevision: number; desiredReplicas: 0 | 1 }) => runtime.scaleDeployment(input.deploymentId, { providerId: input.providerId, expectedDesiredRevision: input.expectedDesiredRevision, desiredReplicas: input.desiredReplicas }, context()), onSuccess: async (_, input) => { await Promise.all([client.invalidateQueries({ queryKey: queryKeys.deployments }), client.invalidateQueries({ queryKey: queryKeys.deployment(input.deploymentId) })]); } }); }
export function useProcesses() { const { runtime } = useGateways(); return useQuery({ queryKey: queryKeys.processes, queryFn: ({ signal }) => runtime.listProcesses(context(signal)).then(page => page.items.map(mapRuntimeProcess)) }); }
export function useProcess(id: string) { const { runtime } = useGateways(); return useQuery({ queryKey: queryKeys.process(id), enabled: id.length > 0, queryFn: ({ signal }) => runtime.getProcess(id, context(signal)).then(mapRuntimeProcess) }); }
export function useRegistryLatest(environment: string) { const { registry } = useGateways(); return useQuery({ queryKey: queryKeys.registryLatest(environment), queryFn: ({ signal }) => registry.latest(environment, context(signal)).then(mapRegistrySnapshot) }); }
export function useRegistryHistory(environment: string) { const { registry } = useGateways(); return useQuery({ queryKey: queryKeys.registryHistory(environment), queryFn: ({ signal }) => registry.history(environment, context(signal)).then(page => page.items.map(mapRegistrySnapshot)) }); }
export function useRegistryDiff(environment: string, from: number, to: number) { const { registry } = useGateways(); return useQuery({ queryKey: queryKeys.registryDiff(environment, from, to), queryFn: ({ signal }) => registry.diff(environment, from, to, context(signal)) }); }
export function useAuditEvents() { const { audit } = useGateways(); return useQuery({ queryKey: queryKeys.audit, queryFn: ({ signal }) => audit.list(context(signal)).then(page => page.items.map(mapAuditEvent)) }); }
