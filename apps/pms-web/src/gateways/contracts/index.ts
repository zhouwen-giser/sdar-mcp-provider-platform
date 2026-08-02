import type {
  AuditEventDto,
  ConfigurationDraftDto,
  ConfigurationPublicationResultDto,
  EffectiveConfigurationPreviewDto,
  ProblemDetailsDto,
  ProviderDto,
  ProviderPackageDto,
  ProviderResourceBindingDto,
  ProviderTypeDto,
  RegistryDiffDto,
  RegistrySnapshotDto,
  RequestBody,
  ResourceDto,
  RuntimeDeploymentDto,
  RuntimeDeploymentIntentDto,
  RuntimeProcessDto,
} from "../../api/types.js";
import type { ProductScenario } from "../../scenarios/types.js";

export interface GatewayContext {
  readonly signal?: AbortSignal;
  readonly correlationId?: string;
  readonly actorId?: string;
}
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}
export interface ProviderGateway {
  listProviderTypes(context?: GatewayContext): Promise<Page<ProviderTypeDto>>;
  getProviderType(providerTypeId: string, context?: GatewayContext): Promise<ProviderTypeDto>;
  listProviderPackages(context?: GatewayContext): Promise<Page<ProviderPackageDto>>;
  getProviderPackage(
    packageId: string,
    version?: string,
    context?: GatewayContext,
  ): Promise<ProviderPackageDto>;
  listProviders(context?: GatewayContext): Promise<Page<ProviderDto>>;
  getProvider(providerId: string, context?: GatewayContext): Promise<ProviderDto>;
  createProvider(
    input: RequestBody<"createProvider">,
    context?: GatewayContext,
  ): Promise<ProviderDto>;
  updateProviderStatus(
    providerId: string,
    input: RequestBody<"updateProviderStatus">,
    context?: GatewayContext,
  ): Promise<ProviderDto>;
}
export interface ResourceGateway {
  listResources(environment: string, context?: GatewayContext): Promise<Page<ResourceDto>>;
  getResource(
    environment: string,
    resourceId: string,
    context?: GatewayContext,
  ): Promise<ResourceDto>;
  createResource(
    input: RequestBody<"createResource">,
    context?: GatewayContext,
  ): Promise<ResourceDto>;
  updateResourceStatus(
    environment: string,
    resourceId: string,
    input: RequestBody<"updateResourceStatus">,
    context?: GatewayContext,
  ): Promise<ResourceDto>;
  listBindings(
    providerId: string,
    context?: GatewayContext,
  ): Promise<Page<ProviderResourceBindingDto>>;
  bind(
    providerId: string,
    input: RequestBody<"bindProviderResource">,
    context?: GatewayContext,
  ): Promise<ProviderResourceBindingDto>;
  unbind(
    providerId: string,
    environment: string,
    resourceId: string,
    context?: GatewayContext,
  ): Promise<void>;
}
export interface ConfigurationGateway {
  createDraft(
    input: RequestBody<"createConfigurationDraft">,
    context?: GatewayContext,
  ): Promise<ConfigurationDraftDto>;
  getDraft(draftId: string, context?: GatewayContext): Promise<ConfigurationDraftDto>;
  updateDraft(
    draftId: string,
    input: RequestBody<"updateConfigurationDraft">,
    context?: GatewayContext,
  ): Promise<ConfigurationDraftDto>;
  validateDraft(draftId: string, context?: GatewayContext): Promise<ConfigurationDraftDto>;
  previewDraft(
    draftId: string,
    context?: GatewayContext,
  ): Promise<EffectiveConfigurationPreviewDto>;
  publishDraft(
    draftId: string,
    input: RequestBody<"publishConfigurationDraft">,
    context?: GatewayContext,
  ): Promise<ConfigurationPublicationResultDto>;
  rollbackDraft(
    draftId: string,
    input: RequestBody<"rollbackConfigurationDraft">,
    context?: GatewayContext,
  ): Promise<ConfigurationPublicationResultDto>;
}
export interface RuntimeGateway {
  listDeployments(
    providerId: string,
    context?: GatewayContext,
  ): Promise<Page<RuntimeDeploymentDto>>;
  getDeployment(
    providerId: string,
    deploymentId: string,
    context?: GatewayContext,
  ): Promise<RuntimeDeploymentDto>;
  createDeployment(
    input: RequestBody<"createRuntimeDeployment">,
    context?: GatewayContext,
  ): Promise<RuntimeDeploymentIntentDto>;
  startDeployment(
    deploymentId: string,
    input: RequestBody<"startRuntimeDeployment">,
    context?: GatewayContext,
  ): Promise<RuntimeDeploymentIntentDto>;
  stopDeployment(
    deploymentId: string,
    input: RequestBody<"stopRuntimeDeployment">,
    context?: GatewayContext,
  ): Promise<RuntimeDeploymentIntentDto>;
  restartDeployment(
    deploymentId: string,
    input: RequestBody<"restartRuntimeDeployment">,
    context?: GatewayContext,
  ): Promise<RuntimeDeploymentIntentDto>;
  scaleDeployment(
    deploymentId: string,
    input: RequestBody<"scaleRuntimeDeployment">,
    context?: GatewayContext,
  ): Promise<RuntimeDeploymentIntentDto>;
  reconcileDeployment(
    deploymentId: string,
    input: RequestBody<"reconcileRuntimeDeployment">,
    context?: GatewayContext,
  ): Promise<RuntimeDeploymentIntentDto>;
  listProcesses(
    providerId: string,
    deploymentId: string,
    context?: GatewayContext,
  ): Promise<Page<RuntimeProcessDto>>;
  getProcess(
    providerId: string,
    instanceId: string,
    context?: GatewayContext,
  ): Promise<RuntimeProcessDto>;
}
export interface RegistryGateway {
  latest(environment: string, context?: GatewayContext): Promise<RegistrySnapshotDto>;
  history(environment: string, context?: GatewayContext): Promise<Page<RegistrySnapshotDto>>;
  diff(
    environment: string,
    fromRevision: number,
    toRevision: number,
    context?: GatewayContext,
  ): Promise<RegistryDiffDto>;
}
export interface AuditGateway {
  list(filters: AuditListFilters, context?: GatewayContext): Promise<Page<AuditEventDto>>;
}
export interface AuditListFilters {
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly correlationId?: string;
  readonly occurredBefore?: string;
  readonly limit?: number;
  readonly cursor?: string;
}
export interface ScenarioController {
  current(): ProductScenario;
  set(next: ProductScenario): void;
  revision(): number;
  subscribe(listener: () => void): () => void;
}
export interface GatewayBundle {
  readonly providers: ProviderGateway;
  readonly resources: ResourceGateway;
  readonly configuration: ConfigurationGateway;
  readonly runtime: RuntimeGateway;
  readonly registry: RegistryGateway;
  readonly audit: AuditGateway;
  readonly scenarios: ScenarioController;
}
export class GatewayProblem extends Error {
  constructor(readonly problem: ProblemDetailsDto) {
    super(problem.code);
  }
}
