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
  RequestBody,
  ResourceDto,
  RuntimeDeploymentDto,
  RuntimeDeploymentIntentDto,
  RuntimeProcessDto,
} from "../../api/types.js";
import type {
  AuditGateway,
  AuditListFilters,
  ConfigurationGateway,
  GatewayBundle,
  GatewayContext,
  Page,
  ProviderGateway,
  RegistryGateway,
  ResourceGateway,
  RuntimeGateway,
  ScenarioController,
} from "../contracts/index.js";
import { GatewayProblem } from "../contracts/index.js";
import type { ProductScenario } from "../../scenarios/types.js";

const BASE_TIME = "2026-07-30T05:00:00.000Z";
const UPDATE_TIME = "2026-07-30T05:15:00.000Z";
const REVISION_ID = "123e4567-e89b-42d3-a456-426614174000";

const providerTypes: ProviderTypeDto[] = [
  { providerTypeId: "ugv", displayName: "Unmanned Ground Vehicle", status: "active", updatedAt: BASE_TIME },
  { providerTypeId: "home-assistant", displayName: "Home Assistant Climate", status: "active", updatedAt: BASE_TIME },
  { providerTypeId: "npc-tank", displayName: "NPC Tank", status: "active", updatedAt: BASE_TIME },
];
const providerPackages: ProviderPackageDto[] = [
  { packageId: "ugv-provider", packageVersion: "1.0.0", providerType: "ugv", hostingModes: ["platform_managed"], configSchemaId: "ugv-config-v1", compatibleRuntimeVersion: "2.0.0-rc.1", protocolMode: "frozen_v1", qualification: { componentStatus: "passed", realResourceStatus: "qualified" } },
  { packageId: "home-assistant-climate", packageVersion: "1.3.0", providerType: "home-assistant", hostingModes: ["vendor_managed", "platform_managed"], configSchemaId: "ha-climate-v2", compatibleRuntimeVersion: "2.0.0-rc.1", protocolMode: "frozen_v1", qualification: { componentStatus: "passed", realResourceStatus: "qualified" } },
  { packageId: "npc-tank-provider", packageVersion: "1.0.0", providerType: "npc-tank", hostingModes: ["platform_managed"], configSchemaId: "npc-tank-v1", compatibleRuntimeVersion: "2.0.0-rc.1", protocolMode: "frozen_v1", qualification: { componentStatus: "partial", realResourceStatus: "pending" } },
];
const providers: ProviderDto[] = [
  { providerId: "ugv-prod-001", providerTypeId: "ugv", packageId: "ugv-provider", packageVersion: "1.0.0", hostingMode: "platform_managed", adapterEndpoint: "127.0.0.1:8101", status: "active", updatedAt: BASE_TIME },
  { providerId: "ha-east-001", providerTypeId: "home-assistant", packageId: "home-assistant-climate", packageVersion: "1.3.0", hostingMode: "vendor_managed", adapterEndpoint: "https://ha-east.example.invalid/mcp", status: "active", updatedAt: BASE_TIME },
  { providerId: "npc-training-001", providerTypeId: "npc-tank", packageId: "npc-tank-provider", packageVersion: "1.0.0", hostingMode: "platform_managed", adapterEndpoint: "127.0.0.1:8111", status: "draft", updatedAt: BASE_TIME },
];
const resources: ResourceDto[] = [
  { environment: "production", resourceId: "ugv-01", resourceType: "ugv", metadata: { displayName: "UGV 01", zone: "north-yard", capabilities: ["navigate", "inspect"] }, status: "available", updatedAt: BASE_TIME },
  { environment: "production", resourceId: "climate-lab", resourceType: "home_assistant_area", metadata: { displayName: "Climate Lab", entityCount: 18 }, status: "available", updatedAt: BASE_TIME },
  { environment: "staging", resourceId: "npc-tank-07", resourceType: "npc_tank", metadata: { displayName: "NPC Tank 07", map: "training-range" }, status: "unavailable", updatedAt: BASE_TIME },
];
const bindings: ProviderResourceBindingDto[] = [
  { providerId: "ugv-prod-001", environment: "production", resourceId: "ugv-01", boundAt: BASE_TIME },
  { providerId: "ha-east-001", environment: "production", resourceId: "climate-lab", boundAt: BASE_TIME },
];
const deployments: RuntimeDeploymentDto[] = [
  { deploymentId: "deploy-001", providerId: "ugv-prod-001", environment: "production", desiredState: "running", desiredReplicas: 1, runtimeVersion: "2.0.0-rc.1", databaseProfileId: "db-profile-001", configProfileId: "production:runtime_deployment:deploy-001:runtime:runtime-main", adapterEndpoint: "127.0.0.1:8101", status: "ACTIVE", desiredRevision: 2, observedRevision: 2 },
  { deploymentId: "deploy-ha-east", providerId: "ha-east-001", environment: "production", desiredState: "running", desiredReplicas: 1, runtimeVersion: "2.0.0-rc.1", databaseProfileId: "db-profile-ha", configProfileId: "production:runtime_deployment:deploy-ha-east:runtime:runtime-main", adapterEndpoint: "https://ha-east.example.invalid/mcp", status: "ACTIVE", desiredRevision: 7, observedRevision: 7 },
];
const processes: RuntimeProcessDto[] = [
  { instanceId: "runtime-001", deploymentId: "deploy-001", processState: "online", livenessState: "healthy", readinessState: "ready", registrationState: "registered", catalogState: "published", runtimeVersion: "2.0.0-rc.1", configRevision: 3, observedRevision: 2, restartCount: 0, lastHeartbeatAt: "2026-07-30T05:13:00.000Z", observedHealth: "READY", readyForActive: true, healthReasonCode: "READY", stale: false, registrationFreshness: "registered", logReference: { referenceId: "runtime-process:runtime-001", tailEndpoint: "/api/v1/runtime-processes/runtime-001/logs/tail", contentIncluded: false } },
  { instanceId: "runtime-ha-east", deploymentId: "deploy-ha-east", processState: "online", livenessState: "healthy", readinessState: "ready", registrationState: "registered", catalogState: "published", runtimeVersion: "2.0.0-rc.1", configRevision: 5, observedRevision: 7, restartCount: 1, lastHeartbeatAt: "2026-07-30T05:14:00.000Z", observedHealth: "READY", readyForActive: true, healthReasonCode: "READY", stale: false, registrationFreshness: "registered", logReference: { referenceId: "runtime-process:runtime-ha-east", tailEndpoint: "/api/v1/runtime-processes/runtime-ha-east/logs/tail", contentIncluded: false } },
];
const drafts: ConfigurationDraftDto[] = [
  { draftId: "draft-001", definitionId: "runtime-config", definitionVersion: 1, key: { environment: "production", targetType: "runtime_deployment", targetId: "deploy-001", configGroup: "runtime", dataId: "runtime-main" }, ancestorTargetIds: { provider: "ugv-prod-001" }, content: { runtime: { port: 8201, logLevel: "info" }, database: { credential: { secretRef: "secret://runtime/ugv-prod/db" } } }, version: 2, status: "validated", applyMode: "restart_required", validationIssues: [], createdAt: BASE_TIME, updatedAt: "2026-07-30T05:10:00.000Z" },
  { draftId: "draft-ha-east", definitionId: "runtime-config", definitionVersion: 1, key: { environment: "production", targetType: "runtime_deployment", targetId: "deploy-ha-east", configGroup: "runtime", dataId: "runtime-main" }, ancestorTargetIds: { provider: "ha-east-001" }, content: { runtime: { port: 8202, logLevel: "warn" }, adapter: { token: { secretRef: "secret://providers/ha-east/token" } } }, version: 1, status: "draft", applyMode: "reconnect_required", validationIssues: [], createdAt: BASE_TIME, updatedAt: BASE_TIME },
];
const publicationResults: ConfigurationPublicationResultDto[] = [
  { outcome: "published", revision: { revisionId: REVISION_ID, target: { environment: "production", targetType: "runtime_deployment", targetId: "deploy-001", configGroup: "runtime", dataId: "runtime-main" }, revision: 3, checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", applyMode: "restart_required", status: "published", content: { runtime: { port: 8201, logLevel: "info" } }, createdAt: "2026-07-30T05:12:00.000Z" } },
  { outcome: "published", revision: { revisionId: "223e4567-e89b-42d3-a456-426614174000", target: { environment: "production", targetType: "runtime_deployment", targetId: "deploy-001", configGroup: "runtime", dataId: "runtime-main" }, revision: 2, checksum: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", applyMode: "hot_reload", status: "superseded", content: { runtime: { port: 8201, logLevel: "debug" } }, createdAt: "2026-07-29T05:12:00.000Z" } },
];
const snapshots: RegistrySnapshotDto[] = [
  { environment: "production", revision: 4, checksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", document: { environment: "production", providers: [ { providerId: "ugv-prod-001", serverId: "ugv-server-001", protocolMode: "frozen_v1", effectiveEndpoint: "http://127.0.0.1:8201/mcp", catalogRevision: 2, tools: [{ name: "io.sdar/taskExecution/checkAvailability", inputSchema: { type: "object" } }, { name: "io.sdar/navigation/navigateTo", inputSchema: { type: "object", required: ["target"] } }] }, { providerId: "ha-east-001", serverId: "ha-server-east", protocolMode: "frozen_v1", effectiveEndpoint: "https://ha-east.example.invalid/mcp", catalogRevision: 5, tools: [{ name: "io.sdar/climate/setTemperature", inputSchema: { type: "object", required: ["entityId", "temperature"] } }] } ] }, publishedAt: "2026-07-30T05:15:00.000Z", createdAt: "2026-07-30T05:15:00.000Z" },
  { environment: "production", revision: 3, checksum: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", document: { environment: "production", providers: [ { providerId: "ugv-prod-001", serverId: "ugv-server-001", protocolMode: "frozen_v1", effectiveEndpoint: "http://127.0.0.1:8201/mcp", catalogRevision: 1, tools: [{ name: "io.sdar/navigation/navigateTo", inputSchema: { type: "object", required: ["target"] } }] } ] }, publishedAt: "2026-07-29T05:15:00.000Z", createdAt: "2026-07-29T05:15:00.000Z" },
];
const audits: AuditEventDto[] = [
  { auditEventId: "audit-001", action: "configuration.rolled_back", actorId: "prototype-admin", correlationId: "corr-001", subjectType: "configuration_revision", subjectId: REVISION_ID, occurredAt: "2026-07-30T05:12:00.000Z" },
  { auditEventId: "audit-002", action: "runtime_deployment.reconciled", actorId: "prototype-admin", correlationId: "corr-runtime-001", subjectType: "runtime_deployment", subjectId: "deploy-001", occurredAt: "2026-07-30T05:11:00.000Z" },
  { auditEventId: "audit-003", action: "provider.created", actorId: "prototype-admin", correlationId: "corr-provider-001", subjectType: "provider", subjectId: "npc-training-001", occurredAt: "2026-07-30T05:00:00.000Z" },
];

function clone<T>(value: T): T { return structuredClone(value); }
function page<T>(items: readonly T[]): Page<T> { return { items: clone(items) }; }

export class ContractMockStore implements ProviderGateway, ResourceGateway, ConfigurationGateway, RuntimeGateway, RegistryGateway, AuditGateway, ScenarioController {
  private scenario: ProductScenario;
  private revisionValue = 0;
  private listeners = new Set<() => void>();
  private providerData = clone(providers);
  private resourceData = clone(resources);
  private bindingData = clone(bindings);
  private deploymentData = clone(deployments);
  private processData = clone(processes);
  private draftData = clone(drafts);
  private revisionData = clone(publicationResults);
  private auditData = clone(audits);
  constructor(initialScenario: ProductScenario) { this.scenario = initialScenario; }
  current() { return this.scenario; }
  revision() { return this.revisionValue; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  set(next: ProductScenario) { this.scenario = next; this.revisionValue += 1; this.emit(); }
  private emit() { for (const listener of this.listeners) listener(); }
  private async gate(context?: GatewayContext) {
    if (context?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const delay = this.scenario === "slow-network" ? 900 : 80;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      context?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
    if (this.scenario === "network-error") this.raise("INTERNAL_ERROR", 503, "Mock network unavailable", context);
  }
  private raise(code: string, status: number, title: string, context?: GatewayContext): never {
    throw new GatewayProblem({ type: `urn:sdar:pms:problem:${code.toLowerCase().replaceAll("_", "-")}`, title, status, code: code as never, detail: title, correlationId: context?.correlationId ?? "corr-mock-001", requestId: "req-mock-001" });
  }
  private updatedAt() { return UPDATE_TIME; }
  private record(action: string, subjectType: string, subjectId: string, context?: GatewayContext) {
    this.auditData.unshift({ auditEventId: `audit-${String(this.auditData.length + 1).padStart(3, "0")}`, action, actorId: context?.actorId ?? "prototype-admin", correlationId: context?.correlationId ?? `corr-${subjectId}`, subjectType, subjectId, occurredAt: UPDATE_TIME });
    this.revisionValue += 1; this.emit();
  }
  async listProviderTypes(context?: GatewayContext) { await this.gate(context); return page(this.scenario === "empty" ? [] : providerTypes); }
  async getProviderType(id: string, context?: GatewayContext) { await this.gate(context); const found = providerTypes.find(x => x.providerTypeId === id); if (!found) this.raise("ENTITY_NOT_FOUND", 404, "Provider type not found", context); return clone(found); }
  async listProviderPackages(context?: GatewayContext) { await this.gate(context); return page(this.scenario === "empty" ? [] : providerPackages); }
  async getProviderPackage(id: string, version?: string, context?: GatewayContext) { await this.gate(context); const found = providerPackages.find(x => x.packageId === id && (version === undefined || x.packageVersion === version)); if (!found) this.raise("ENTITY_NOT_FOUND", 404, "Provider package not found", context); return clone(found); }
  async listProviders(context?: GatewayContext) { await this.gate(context); let data = clone(this.providerData); if (this.scenario === "empty") data = []; if (this.scenario === "provider-degraded" && data[0]) data[0] = { ...data[0], status: "degraded" }; if (this.scenario === "partial-data") data = data.slice(0, 1); return page(data); }
  async getProvider(id: string, context?: GatewayContext) { await this.gate(context); const found = (await this.listProviders()).items.find(x => x.providerId === id); if (!found) this.raise("ENTITY_NOT_FOUND", 404, "Provider not found", context); return clone(found); }
  async createProvider(input: RequestBody<"createProvider">, context?: GatewayContext) { await this.gate(context); if (this.providerData.some(x => x.providerId === input.providerId)) this.raise("ENTITY_ALREADY_EXISTS", 409, "Provider already exists", context); const created: ProviderDto = { providerId: input.providerId, providerTypeId: input.providerTypeId, ...(input.packageId === undefined ? {} : { packageId: input.packageId }), ...(input.packageVersion === undefined ? {} : { packageVersion: input.packageVersion }), hostingMode: input.hostingMode ?? "platform_managed", ...(input.adapterEndpoint === undefined ? {} : { adapterEndpoint: input.adapterEndpoint }), status: "draft", updatedAt: this.updatedAt() }; this.providerData.push(created); this.record("provider.created", "provider", created.providerId, context); return clone(created); }
  async updateProviderStatus(id: string, input: RequestBody<"updateProviderStatus">, context?: GatewayContext) { await this.gate(context); const index = this.providerData.findIndex(x => x.providerId === id); if (index < 0) this.raise("ENTITY_NOT_FOUND", 404, "Provider not found", context); const current = this.providerData[index]!; if (current.updatedAt !== input.expectedUpdatedAt) this.raise("OPTIMISTIC_CONCURRENCY_CONFLICT", 409, "Provider changed; reload and retry", context); const updated: ProviderDto = { ...current, status: input.status, updatedAt: this.updatedAt() }; this.providerData[index] = updated; this.record("provider.status_updated", "provider", id, context); return clone(updated); }
  async listResources(environment: string, context?: GatewayContext) { await this.gate(context); return page(this.scenario === "empty" ? [] : this.resourceData.filter(item => item.environment === environment)); }
  async getResource(environment: string, id: string, context?: GatewayContext) { await this.gate(context); const found = this.resourceData.find(x => x.environment === environment && x.resourceId === id); if (!found) this.raise("ENTITY_NOT_FOUND", 404, "Resource not found", context); return clone(found); }
  async createResource(input: RequestBody<"createResource">, context?: GatewayContext) { await this.gate(context); if (this.resourceData.some(x => x.environment === input.environment && x.resourceId === input.resourceId)) this.raise("ENTITY_ALREADY_EXISTS", 409, "Resource already exists", context); const created: ResourceDto = { ...input, metadata: input.metadata ?? {}, status: "available", updatedAt: this.updatedAt() }; this.resourceData.push(created); this.record("resource.created", "resource", created.resourceId, context); return clone(created); }
  async updateResourceStatus(environment: string, id: string, input: RequestBody<"updateResourceStatus">, context?: GatewayContext) { await this.gate(context); const index = this.resourceData.findIndex(x => x.environment === environment && x.resourceId === id); if (index < 0) this.raise("ENTITY_NOT_FOUND", 404, "Resource not found", context); const current = this.resourceData[index]!; if (current.updatedAt !== input.expectedUpdatedAt) this.raise("OPTIMISTIC_CONCURRENCY_CONFLICT", 409, "Resource changed; reload and retry", context); const updated: ResourceDto = { ...current, status: input.status, updatedAt: this.updatedAt() }; this.resourceData[index] = updated; this.record("resource.status_updated", "resource", id, context); return clone(updated); }
  async listBindings(providerId: string, context?: GatewayContext) { await this.gate(context); return page(this.bindingData.filter(x => x.providerId === providerId)); }
  async bind(providerId: string, input: RequestBody<"bindProviderResource">, context?: GatewayContext) { await this.gate(context); if (this.bindingData.some(x => x.providerId === providerId && x.environment === input.environment && x.resourceId === input.resourceId)) this.raise("DUPLICATE_RESOURCE_BINDING", 409, "Binding already exists", context); const binding = { providerId, environment: input.environment, resourceId: input.resourceId, boundAt: this.updatedAt() }; this.bindingData.push(binding); this.record("provider.resource_bound", "provider", providerId, context); return clone(binding); }
  async unbind(providerId: string, environment: string, resourceId: string, context?: GatewayContext) { await this.gate(context); const index = this.bindingData.findIndex(x => x.providerId === providerId && x.environment === environment && x.resourceId === resourceId); if (index < 0) this.raise("RESOURCE_BINDING_NOT_FOUND", 404, "Binding not found", context); this.bindingData.splice(index, 1); this.record("provider.resource_unbound", "provider", providerId, context); }
  async createDraft(input: RequestBody<"createConfigurationDraft">, context?: GatewayContext) { await this.gate(context); if (this.draftData.some(x => x.draftId === input.draftId)) this.raise("CONFIGURATION_BUSINESS_KEY_CONFLICT", 409, "Draft already exists", context); const draft: ConfigurationDraftDto = { draftId: input.draftId, definitionId: input.definitionId, definitionVersion: 1, key: { environment: input.environment, targetType: input.targetType, targetId: input.targetId, configGroup: input.configGroup, dataId: input.dataId }, ancestorTargetIds: input.ancestorTargetIds ?? {}, content: input.content, version: 1, status: "draft", validationIssues: [], createdAt: BASE_TIME, updatedAt: BASE_TIME }; this.draftData.push(draft); this.record("configuration.draft_created", "configuration_draft", draft.draftId, context); return clone(draft); }
  async getDraft(id: string, context?: GatewayContext) { await this.gate(context); const found = this.draftData.find(x => x.draftId === id); if (!found) this.raise("CONFIGURATION_DRAFT_NOT_FOUND", 404, "Configuration draft not found", context); return clone(found); }
  async updateDraft(id: string, input: RequestBody<"updateConfigurationDraft">, context?: GatewayContext) { await this.gate(context); const index = this.draftData.findIndex(x => x.draftId === id); if (index < 0) this.raise("CONFIGURATION_DRAFT_NOT_FOUND", 404, "Configuration draft not found", context); const current = this.draftData[index]!; if (current.version !== input.expectedVersion) this.raise("CONFIGURATION_DRAFT_VERSION_CONFLICT", 409, "Draft changed; reload and retry", context); const updated: ConfigurationDraftDto = { ...current, ancestorTargetIds: input.ancestorTargetIds ?? current.ancestorTargetIds, content: input.content, version: current.version + 1, status: "draft", validationIssues: [], updatedAt: this.updatedAt() }; this.draftData[index] = updated; this.record("configuration.draft_updated", "configuration_draft", id, context); return clone(updated); }
  async validateDraft(id: string, context?: GatewayContext) { await this.gate(context); const index = this.draftData.findIndex(x => x.draftId === id); if (index < 0) this.raise("CONFIGURATION_DRAFT_NOT_FOUND", 404, "Configuration draft not found", context); const invalid = this.scenario === "configuration-invalid"; const issues = invalid ? [{ code: "PLAINTEXT_SECRET_REJECTED" as const, path: "database.password", message: "Secret values must use SecretRef." }] : []; const updated: ConfigurationDraftDto = { ...this.draftData[index]!, status: invalid ? "invalid" : "validated", validationIssues: issues, updatedAt: this.updatedAt() }; this.draftData[index] = updated; this.record("configuration.draft_validated", "configuration_draft", id, context); return clone(updated); }
  async previewDraft(id: string, context?: GatewayContext) { const draft = await this.getDraft(id, context); const preview: EffectiveConfigurationPreviewDto = { draftId: draft.draftId, definitionId: draft.definitionId, definitionVersion: draft.definitionVersion, content: draft.content, sources: Object.fromEntries(Object.keys(draft.content).map(key => [key, draft.key.targetType])), applyMode: draft.applyMode ?? "hot_reload", valid: draft.status !== "invalid", issues: draft.validationIssues }; return preview; }
  async publishDraft(id: string, input: RequestBody<"publishConfigurationDraft">, context?: GatewayContext) { await this.gate(context); const draft = await this.getDraft(id); if (draft.status !== "validated") this.raise("CONFIGURATION_DRAFT_NOT_VALIDATED", 409, "Draft must be validated", context); if (draft.version !== input.expectedDraftVersion) this.raise("CONFIGURATION_DRAFT_VERSION_CONFLICT", 409, "Draft version conflict", context); const currentRevision = this.revisionData[0]?.revision.revision ?? 0; if (input.expectedPublishedRevision !== null && input.expectedPublishedRevision !== currentRevision) this.raise("CONFIGURATION_PUBLISH_CONFLICT", 409, "Published revision changed", context); if (this.scenario === "configuration-no-change") { const result: ConfigurationPublicationResultDto = { outcome: "no_change", revision: this.revisionData[0]!.revision }; return clone(result); } const result: ConfigurationPublicationResultDto = { outcome: "published", revision: { revisionId: `323e4567-e89b-42d3-a456-${String(currentRevision + 1).padStart(12, "0")}`, target: draft.key, revision: currentRevision + 1, checksum: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", applyMode: draft.applyMode ?? "hot_reload", status: "published", content: draft.content, createdAt: this.updatedAt() } }; this.revisionData.unshift(result); this.record("configuration.published", "configuration_revision", result.revision.revisionId, context); return clone(result); }
  async rollbackDraft(id: string, input: RequestBody<"rollbackConfigurationDraft">, context?: GatewayContext) { await this.gate(context); const draft = await this.getDraft(id); if (draft.version !== input.expectedDraftVersion) this.raise("CONFIGURATION_DRAFT_VERSION_CONFLICT", 409, "Draft version conflict", context); const source = this.revisionData.find(x => x.revision.revisionId === input.sourceRevisionId); if (!source) this.raise("CONFIGURATION_REVISION_NOT_FOUND", 404, "Source revision not found", context); const currentRevision = this.revisionData[0]?.revision.revision ?? 0; if (input.expectedPublishedRevision !== null && input.expectedPublishedRevision !== currentRevision) this.raise("CONFIGURATION_PUBLISH_CONFLICT", 409, "Published revision changed", context); const result: ConfigurationPublicationResultDto = { outcome: "published", revision: { ...source.revision, revisionId: `423e4567-e89b-42d3-a456-${String(currentRevision + 1).padStart(12, "0")}`, revision: currentRevision + 1, status: "published", createdAt: this.updatedAt() } }; this.revisionData.unshift(result); this.record("configuration.rolled_back", "configuration_revision", result.revision.revisionId, context); return clone(result); }
  async listDeployments(providerId: string, context?: GatewayContext) { await this.gate(context); let data = clone(this.deploymentData.filter(item => item.providerId === providerId)); if (this.scenario === "empty") data = []; if (this.scenario === "runtime-failed" && data[0]) data[0] = { ...data[0], status: "FAILED", observedRevision: Math.max(0, data[0].desiredRevision - 1) }; if (this.scenario === "partial-data") data = data.slice(0, 1); return page(data); }
  async getDeployment(providerId: string, id: string, context?: GatewayContext) { await this.gate(context); const found = this.deploymentData.find(item => item.providerId === providerId && item.deploymentId === id); if (!found) this.raise("RUNTIME_DEPLOYMENT_NOT_FOUND", 404, "Runtime deployment not found", context); return clone(found); }
  async createDeployment(input: RequestBody<"createRuntimeDeployment">, context?: GatewayContext) { await this.gate(context); if (this.deploymentData.some(x => x.deploymentId === input.deploymentId)) this.raise("ENTITY_ALREADY_EXISTS", 409, "Deployment already exists", context); const deployment: RuntimeDeploymentDto = { deploymentId: input.deploymentId, providerId: input.providerId, environment: input.environment, desiredState: input.desiredReplicas === 0 ? "stopped" : "running", desiredReplicas: input.desiredReplicas ?? 1, runtimeVersion: input.runtimeVersion, databaseProfileId: input.databaseProfileId, configProfileId: input.configProfileId, ...(input.adapterEndpoint === undefined ? {} : { adapterEndpoint: input.adapterEndpoint }), status: "REQUESTED", desiredRevision: 1, observedRevision: 0 }; this.deploymentData.push(deployment); const intent = { operationId: context?.correlationId ?? `corr-${deployment.deploymentId}-create`, deployment }; this.record("runtime_deployment.created", "runtime_deployment", deployment.deploymentId, context); return clone(intent); }
  private async deploymentIntent(id: string, input: { providerId: string; expectedDesiredRevision: number; desiredReplicas?: number }, action: "start" | "stop" | "restart" | "scale" | "reconcile", context?: GatewayContext): Promise<RuntimeDeploymentIntentDto> { await this.gate(context); const index = this.deploymentData.findIndex(x => x.deploymentId === id); if (index < 0) this.raise("RUNTIME_DEPLOYMENT_NOT_FOUND", 404, "Runtime deployment not found", context); const current = this.deploymentData[index]!; if (this.scenario === "runtime-revision-conflict" || current.desiredRevision !== input.expectedDesiredRevision) this.raise("RUNTIME_DEPLOYMENT_REVISION_CONFLICT", 409, "Desired revision conflict", context); if (current.providerId !== input.providerId) this.raise("RUNTIME_DEPLOYMENT_PROVIDER_UNAVAILABLE", 409, "Provider mismatch", context); const desiredReplicas = action === "scale" ? (input.desiredReplicas ?? current.desiredReplicas) : action === "stop" ? 0 : action === "start" ? 1 : current.desiredReplicas; const desiredState = action === "stop" || desiredReplicas === 0 ? "stopped" : "running"; const nextRevision = current.desiredRevision + 1; const updated: RuntimeDeploymentDto = { ...current, desiredState, desiredReplicas, desiredRevision: nextRevision, status: action === "stop" ? "DRAINING" : "REQUESTED" }; this.deploymentData[index] = updated; this.record(`runtime_deployment.${action}`, "runtime_deployment", id, context); return clone({ operationId: context?.correlationId ?? `corr-${id}-${action}-${nextRevision}`, deployment: updated }); }
  startDeployment(id: string, input: RequestBody<"startRuntimeDeployment">, context?: GatewayContext) { return this.deploymentIntent(id, input, "start", context); }
  stopDeployment(id: string, input: RequestBody<"stopRuntimeDeployment">, context?: GatewayContext) { return this.deploymentIntent(id, input, "stop", context); }
  restartDeployment(id: string, input: RequestBody<"restartRuntimeDeployment">, context?: GatewayContext) { return this.deploymentIntent(id, input, "restart", context); }
  scaleDeployment(id: string, input: RequestBody<"scaleRuntimeDeployment">, context?: GatewayContext) { return this.deploymentIntent(id, input, "scale", context); }
  reconcileDeployment(id: string, input: RequestBody<"reconcileRuntimeDeployment">, context?: GatewayContext) { return this.deploymentIntent(id, input, "reconcile", context); }
  async listProcesses(providerId: string, deploymentId: string, context?: GatewayContext) { await this.gate(context); const providerDeployments = new Set(this.deploymentData.filter(item => item.providerId === providerId).map(item => item.deploymentId)); let data = clone(this.processData.filter(item => item.deploymentId === deploymentId && providerDeployments.has(item.deploymentId))); if (this.scenario === "empty") data = []; if (this.scenario === "runtime-failed" && data[0]) data[0] = { ...data[0], processState: "errored", readinessState: "not_ready", registrationState: "stale", catalogState: "stale", observedHealth: "FAILED", readyForActive: false, stale: true, registrationFreshness: "stale" }; if (this.scenario === "partial-data") data = data.slice(0, 1); return page(data); }
  async getProcess(providerId: string, id: string, context?: GatewayContext) { await this.gate(context); const providerDeployments = new Set(this.deploymentData.filter(item => item.providerId === providerId).map(item => item.deploymentId)); const found = this.processData.find(item => item.instanceId === id && providerDeployments.has(item.deploymentId)); if (!found) this.raise("RUNTIME_PROCESS_NOT_FOUND", 404, "Runtime process not found", context); return clone(found); }
  async latest(environment: string, context?: GatewayContext) { await this.gate(context); const found = snapshots.find(x => x.environment === environment); if (!found) this.raise("REGISTRY_SNAPSHOT_NOT_FOUND", 404, "Registry snapshot not found", context); return clone(found); }
  async history(environment: string, context?: GatewayContext) { await this.gate(context); return page(snapshots.filter(x => x.environment === environment)); }
  async diff(environment: string, fromRevision: number, toRevision: number, context?: GatewayContext) { await this.gate(context); const before = snapshots.find(x => x.environment === environment && x.revision === fromRevision); const after = snapshots.find(x => x.environment === environment && x.revision === toRevision); if (!before || !after) this.raise("REGISTRY_SNAPSHOT_NOT_FOUND", 404, "Registry revision not found", context); const beforeMap = new Map(before.document.providers.map(x => [x.providerId, x])); const afterMap = new Map(after.document.providers.map(x => [x.providerId, x])); const diff: RegistryDiffDto = { environment, fromRevision, toRevision, added: after.document.providers.filter(x => !beforeMap.has(x.providerId)), removed: before.document.providers.filter(x => !afterMap.has(x.providerId)), changed: after.document.providers.filter(x => beforeMap.has(x.providerId) && JSON.stringify(beforeMap.get(x.providerId)) !== JSON.stringify(x)).map(afterProvider => ({ providerId: afterProvider.providerId, before: beforeMap.get(afterProvider.providerId)!, after: afterProvider })) }; return clone(diff); }
  async list(filters: AuditListFilters, context?: GatewayContext) { await this.gate(context); let data = this.scenario === "empty" ? [] : this.auditData; if (filters.subjectType !== undefined) data = data.filter(item => item.subjectType === filters.subjectType); if (filters.subjectId !== undefined) data = data.filter(item => item.subjectId === filters.subjectId); if (filters.correlationId !== undefined) data = data.filter(item => item.correlationId === filters.correlationId); if (filters.occurredBefore !== undefined) data = data.filter(item => item.occurredAt < filters.occurredBefore!); if (filters.cursor !== undefined) data = data.slice(Number(filters.cursor)); if (filters.limit !== undefined) data = data.slice(0, filters.limit); return page(data); }
}

export function createContractMockGateways(initialScenario: ProductScenario): GatewayBundle {
  const store = new ContractMockStore(initialScenario);
  return { providers: store, resources: store, configuration: store, runtime: store, registry: store, audit: store, scenarios: store };
}
