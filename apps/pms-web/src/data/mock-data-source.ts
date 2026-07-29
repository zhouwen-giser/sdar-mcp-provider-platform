import {
  advanceOperation as advancePrototypeOperation,
  browserPrototypeClock,
  createOperation,
  type PrototypeClock,
} from "../prototype/operations.js";
import { buildScenario } from "./scenarios.js";
import type {
  DashboardSnapshot,
  AuditEvent,
  CatalogOperationSummary,
  ConfigurationProfile,
  IncidentSummary,
  MockCheckResult,
  PmsWebDataSource,
  PrototypeOperation,
  PrototypeScenario,
  ProviderOnboardingDraft,
  ProviderSummary,
  ResourceSummary,
  RuntimeDeploymentDraft,
  RuntimeDeploymentSummary,
  RuntimeConfigurationAck,
  RuntimeProcessSummary,
  RegistryRevision,
  SimulatedOperationInput,
  WorkerJobSummary,
} from "./types.js";
import {
  AUDIT_EVENTS,
  CATALOG_OPERATIONS,
  CONFIGURATION_PROFILES,
  REGISTRY_REVISIONS,
} from "./fixtures.js";

export class MockPmsWebDataSource implements PmsWebDataSource {
  readonly #listeners = new Set<() => void>();
  readonly #operations = new Map<string, PrototypeOperation>();
  readonly #failureSteps = new Map<string, number | undefined>();
  readonly #operationEffects = new Map<string, (operation: PrototypeOperation) => void>();
  #operationSnapshot: readonly PrototypeOperation[] = [];
  readonly #onboardedProviders = new Map<string, ProviderSummary>();
  readonly #createdDeployments = new Map<string, RuntimeDeploymentSummary>();
  readonly #deploymentOverrides = new Map<string, RuntimeDeploymentSummary>();
  readonly #processOverrides = new Map<string, RuntimeProcessSummary>();
  readonly #createdJobs = new Map<string, WorkerJobSummary>();
  readonly #configurationAcks = new Map<string, readonly RuntimeConfigurationAck[]>();
  readonly #incidentOverrides = new Map<string, IncidentSummary>();
  readonly #catalogOverrides = new Map<string, CatalogOperationSummary>();
  #revision = 0;

  constructor(
    private currentScenario: PrototypeScenario = "healthy",
    private readonly clock: PrototypeClock = browserPrototypeClock,
  ) {}

  scenario(): PrototypeScenario {
    return this.currentScenario;
  }

  revision(): number {
    return this.#revision;
  }

  setScenario(scenario: PrototypeScenario): void {
    this.currentScenario = scenario;
    this.#emit();
  }

  async dashboard(): Promise<DashboardSnapshot> {
    return this.#read((dataset) => dataset.dashboard);
  }

  async providers(): Promise<readonly ProviderSummary[]> {
    const providers = await this.#read((dataset) => dataset.providers);
    return [...providers, ...this.#onboardedProviders.values()];
  }

  async provider(providerId: string): Promise<ProviderSummary | undefined> {
    const onboarded = this.#onboardedProviders.get(providerId);
    if (onboarded !== undefined) return onboarded;
    return this.#read((dataset) =>
      dataset.providers.find((provider) => provider.providerId === providerId),
    );
  }

  async resources(): Promise<readonly ResourceSummary[]> {
    return this.#read((dataset) => dataset.resources);
  }

  async deployments(): Promise<readonly RuntimeDeploymentSummary[]> {
    const deployments = await this.#read((dataset) => dataset.deployments);
    return [
      ...deployments.map(
        (deployment) => this.#deploymentOverrides.get(deployment.deploymentId) ?? deployment,
      ),
      ...this.#createdDeployments.values(),
    ];
  }

  async deployment(deploymentId: string): Promise<RuntimeDeploymentSummary | undefined> {
    return (await this.deployments()).find(
      (deployment) => deployment.deploymentId === deploymentId,
    );
  }

  async runtimeProcesses(): Promise<readonly RuntimeProcessSummary[]> {
    const processes = await this.#read((dataset) => dataset.processes);
    return processes.map((process) => this.#processOverrides.get(process.processId) ?? process);
  }

  async jobs(): Promise<readonly WorkerJobSummary[]> {
    const jobs = await this.#read((dataset) => dataset.jobs);
    const baseIds = new Set(jobs.map((job) => job.jobId));
    return [
      ...jobs.map((job) => this.#createdJobs.get(job.jobId) ?? job),
      ...[...this.#createdJobs.values()].filter((job) => !baseIds.has(job.jobId)),
    ];
  }

  requeueJob(jobId: string): PrototypeOperation {
    const existing = [
      ...buildScenario(this.currentScenario).jobs,
      ...this.#createdJobs.values(),
    ].find((job) => job.jobId === jobId);
    if (existing === undefined) throw new Error("PROTOTYPE_JOB_NOT_FOUND");
    const operation = this.startOperation({
      label: `模拟重新入队 ${jobId}`,
      steps: ["Validate Fence", "Create Attempt", "Enqueue"],
    });
    this.#createdJobs.set(jobId, {
      ...existing,
      status: "PENDING",
      attempts: existing.attempts + 1,
      fenceToken: `${existing.fenceToken}-retry`,
      timeline: [...existing.timeline, "SIMULATED_REENQUEUE"],
    });
    this.#emit();
    return operation;
  }

  async configurationProfiles(): Promise<readonly ConfigurationProfile[]> {
    if (this.currentScenario === "network-error") throw new Error("MOCK_DATA_UNAVAILABLE");
    const profiles = structuredClone(CONFIGURATION_PROFILES) as unknown as ConfigurationProfile[];
    if (this.currentScenario === "pending-approval") {
      return profiles.map((profile, index) =>
        index === 0 ? { ...profile, status: "PENDING_APPROVAL" } : profile,
      );
    }
    if (this.currentScenario === "partial-data") return profiles.slice(0, 1);
    return profiles;
  }

  async runtimeConfigurationAcks(
    profileId: string,
  ): Promise<readonly RuntimeConfigurationAck[]> {
    const override = this.#configurationAcks.get(profileId);
    if (override !== undefined) return override;
    const revision = profileId === "provider-runtime" ? 43 : 18;
    const base: RuntimeConfigurationAck[] = [
      {
        runtimeId: "deploy-ha-primary",
        profileId,
        revision: revision - 1,
        status: this.currentScenario === "config-drift" ? "OFFLINE" : "APPLIED",
        detail:
          this.currentScenario === "config-drift"
            ? "最后心跳早于当前 revision"
            : "模拟 ACK 已确认",
      },
      {
        runtimeId: "deploy-ugv-primary",
        profileId,
        revision: revision - 1,
        status: "RESTART_REQUIRED",
        detail: "database.poolSize 需要重启",
      },
      {
        runtimeId: "deploy-npc-primary",
        profileId,
        revision: revision - 1,
        status: this.currentScenario === "partial-data" ? "PENDING" : "REJECTED",
        detail: "模拟 schema version 不兼容",
      },
    ];
    return base;
  }

  publishConfiguration(profileId: string): PrototypeOperation {
    const operation = this.startOperation({
      label: `模拟发布配置 ${profileId}`,
      steps: ["Publish Revision", "Runtime Pull", "Validate / Apply", "Collect ACK"],
    });
    this.#configurationAcks.set(
      profileId,
      [
        {
          runtimeId: "deploy-ha-primary",
          profileId,
          revision: 43,
          status: "PENDING",
          detail: "等待模拟 Pull",
        },
        {
          runtimeId: "deploy-ugv-primary",
          profileId,
          revision: 43,
          status: "PENDING",
          detail: "等待模拟 Pull",
        },
      ],
    );
    this.#operationEffects.set(operation.operationId, (current) => {
      const complete = current.status === "COMPLETED";
      this.#configurationAcks.set(profileId, [
        {
          runtimeId: "deploy-ha-primary",
          profileId,
          revision: 43,
          status: complete ? "APPLIED" : "PENDING",
          detail: complete ? "Hot Reload 模拟 ACK" : "等待模拟 Apply",
        },
        {
          runtimeId: "deploy-ugv-primary",
          profileId,
          revision: 43,
          status: complete ? "RESTART_REQUIRED" : "PENDING",
          detail: complete ? "配置已拉取，需模拟重启" : "等待模拟 Apply",
        },
      ]);
    });
    this.#emit();
    return operation;
  }

  createRuntimeDeployment(draft: RuntimeDeploymentDraft): {
    readonly deployment: RuntimeDeploymentSummary;
    readonly operation: PrototypeOperation;
  } {
    const deployment: RuntimeDeploymentSummary = {
      deploymentId: `deploy-${draft.providerId.replace(/^provider-/, "")}-prototype-${String(
        this.#createdDeployments.size + 1,
      )}`,
      providerId: draft.providerId,
      release: draft.release,
      desiredState: "ACTIVE",
      observedState: "REQUESTED",
      desiredRevision: 1,
      observedRevision: 0,
      configRevision: Number.parseInt(draft.configurationProfileId.match(/\d+$/)?.[0] ?? "1", 10),
    };
    this.#createdDeployments.set(deployment.deploymentId, deployment);
    const operation = this.startOperation({
      label: `模拟创建 ${deployment.deploymentId}`,
      steps: ["REQUESTED", "PROVISIONING", "STARTING", "REGISTERING", "ACTIVE"],
    });
    this.#operationEffects.set(operation.operationId, (current) => {
      const running = current.steps.find((step) => step.status === "RUNNING")?.label;
      const complete = current.status === "COMPLETED";
      const observedState: RuntimeDeploymentSummary["observedState"] =
        complete || running === "ACTIVE"
          ? "ACTIVE"
          : running === "PROVISIONING"
            ? "PROVISIONING"
            : running === "STARTING" || running === "REGISTERING"
              ? "STARTING"
              : "REQUESTED";
      this.#createdDeployments.set(deployment.deploymentId, {
        ...deployment,
        observedState,
        observedRevision: complete ? 1 : 0,
      });
    });
    this.#emit();
    return { deployment, operation };
  }

  reconcileRuntime(deploymentId: string): {
    readonly job: WorkerJobSummary;
    readonly operation: PrototypeOperation;
  } {
    const job: WorkerJobSummary = {
      jobId: `job-reconcile-${deploymentId}`,
      kind: "RECONCILE_RUNTIME",
      aggregateId: deploymentId,
      status: "PENDING",
      attempts: 1,
      updatedAt: "Prototype clock",
      leaseOwner: "worker-mock-reconcile",
      fenceToken: `fence-${deploymentId}`,
      timeline: ["ENQUEUED"],
    };
    this.#createdJobs.set(job.jobId, job);
    const operation = this.startOperation({
      label: `模拟 Reconcile ${deploymentId}`,
      steps: ["读取 Desired State", "检查 PM2 投影", "刷新 Registration", "Observed ACTIVE"],
    });
    this.#operationEffects.set(operation.operationId, (current) => {
      this.#createdJobs.set(job.jobId, {
        ...job,
        status: current.status === "COMPLETED" ? "COMPLETED" : "RUNNING",
      });
      if (current.status !== "COMPLETED") return;
      const existing = buildScenario(this.currentScenario).deployments.find(
        (deployment) => deployment.deploymentId === deploymentId,
      );
      if (existing !== undefined) {
        this.#deploymentOverrides.set(deploymentId, {
          ...existing,
          observedState: "ACTIVE",
          observedRevision: existing.desiredRevision,
        });
      }
      const process = buildScenario(this.currentScenario).processes.find(
        (item) => item.deploymentId === deploymentId,
      );
      if (process !== undefined) {
        this.#processOverrides.set(process.processId, {
          ...process,
          healthStatus: "ACTIVE",
          registrationStatus: "REGISTERED",
          observedRevision:
            this.#deploymentOverrides.get(deploymentId)?.desiredRevision ??
            process.observedRevision,
        });
      }
    });
    this.#emit();
    return { job, operation };
  }

  async incidents(): Promise<readonly IncidentSummary[]> {
    const incidents = await this.#read((dataset) => dataset.incidents);
    return incidents.map(
      (incident) => this.#incidentOverrides.get(incident.incidentId) ?? incident,
    );
  }

  closeIncident(incidentId: string): PrototypeOperation {
    const incident = buildScenario(this.currentScenario).incidents.find(
      (item) => item.incidentId === incidentId,
    );
    if (incident === undefined) throw new Error("PROTOTYPE_INCIDENT_NOT_FOUND");
    const operation = this.startOperation({
      label: `模拟关闭 Incident ${incidentId}`,
      steps: ["Verify Recovery", "Record Resolution", "Close Incident"],
    });
    this.#operationEffects.set(operation.operationId, (current) => {
      if (current.status !== "COMPLETED") return;
      this.#incidentOverrides.set(incidentId, {
        ...incident,
        status: "CLOSED",
        timeline: [...incident.timeline, "SIMULATED_CLOSED"],
      });
    });
    return operation;
  }

  async catalogOperations(): Promise<readonly CatalogOperationSummary[]> {
    if (this.currentScenario === "network-error") throw new Error("MOCK_DATA_UNAVAILABLE");
    const operations = structuredClone(CATALOG_OPERATIONS) as unknown as CatalogOperationSummary[];
    const withScenario = operations.map((operation, index) =>
      this.currentScenario === "catalog-breaking" && index === 0
        ? {
            ...operation,
            revision: 43,
            compatibility: "BREAKING" as const,
            registryStatus: "BLOCKED" as const,
            schema: {
              ...operation.schema,
              required: ["resourceId", "temperature", "safetyApproval"],
            },
          }
        : operation,
    );
    return withScenario.map(
      (operation) =>
        this.#catalogOverrides.get(`${operation.providerId}/${operation.operationName}`) ??
        operation,
    );
  }

  async registryRevisions(): Promise<readonly RegistryRevision[]> {
    const revisions = structuredClone(REGISTRY_REVISIONS) as unknown as RegistryRevision[];
    if (this.currentScenario !== "catalog-breaking") return revisions;
    return [
      {
        revision: 43,
        status: "BLOCKED",
        checksum: "sha256:catalog-mock-43-breaking",
        operationCount: 8,
        createdAt: "Prototype clock",
      },
      ...revisions,
    ];
  }

  rediscoverCatalog(providerId: string): PrototypeOperation {
    return this.startOperation({
      label: `模拟重新发现 ${providerId}`,
      steps: ["Enqueue Discovery", "Read Mock Schema", "Classify Compatibility"],
    });
  }

  publishCatalog(providerId: string): PrototypeOperation {
    const operation = this.startOperation({
      label: `模拟发布 Catalog ${providerId}`,
      steps: ["Verify Review", "Create Registry Revision", "Publish Mock Projection"],
    });
    this.#operationEffects.set(operation.operationId, (current) => {
      if (current.status !== "COMPLETED") return;
      for (const item of CATALOG_OPERATIONS.filter(
        (candidate) => candidate.providerId === providerId,
      )) {
        this.#catalogOverrides.set(`${item.providerId}/${item.operationName}`, {
          ...(structuredClone(item) as unknown as CatalogOperationSummary),
          revision: item.revision + 1,
          compatibility: "COMPATIBLE",
          registryStatus: "PUBLISHED",
        });
      }
    });
    return operation;
  }

  async auditEvents(): Promise<readonly AuditEvent[]> {
    return structuredClone(AUDIT_EVENTS) as unknown as AuditEvent[];
  }

  async checkAdapter(draft: ProviderOnboardingDraft): Promise<MockCheckResult> {
    const passed = draft.adapterEndpoint.startsWith("mock://");
    return {
      passed,
      code: passed ? "MOCK_ADAPTER_REACHABLE" : "MOCK_ADAPTER_ENDPOINT_INVALID",
      summary: passed
        ? "模拟 Adapter 握手、能力与 TLS 元数据检查通过。"
        : "原型只接受 mock:// Adapter Endpoint。",
      blockers: passed ? [] : ["Adapter Endpoint 必须使用 mock:// 前缀"],
    };
  }

  async preflightProvider(draft: ProviderOnboardingDraft): Promise<MockCheckResult> {
    const blockers = [
      ...(draft.databaseProfileId.length === 0 ? ["请选择 Database Profile"] : []),
      ...(draft.runtimeRelease.length === 0 ? ["请选择 Runtime Release"] : []),
      ...(this.#onboardedProviders.has(draft.providerId) ? ["Provider ID 已存在"] : []),
    ];
    return {
      passed: blockers.length === 0,
      code: blockers.length === 0 ? "MOCK_PREFLIGHT_READY" : "MOCK_PREFLIGHT_BLOCKED",
      summary:
        blockers.length === 0
          ? "模拟依赖、配置、放置和命名检查通过。"
          : "存在阻断项，不能提交模拟操作。",
      blockers,
    };
  }

  onboardProvider(draft: ProviderOnboardingDraft): {
    readonly provider: ProviderSummary;
    readonly operation: PrototypeOperation;
  } {
    const provider: ProviderSummary = {
      providerId: draft.providerId,
      name: draft.name,
      type: draft.packageId,
      environment: draft.environment,
      status: "PENDING",
      resourceCount: 0,
      deploymentCount: 1,
      observedAt: "等待模拟发现",
    };
    this.#onboardedProviders.set(provider.providerId, provider);
    const operation = this.startOperation({
      label: `模拟接入 ${provider.name}`,
      steps: ["登记 Provider", "准备 Database Profile", "创建 RuntimeDeployment", "等待发现"],
    });
    this.#emit();
    return { provider, operation };
  }

  startOperation(input: SimulatedOperationInput): PrototypeOperation {
    const operation = createOperation(input, this.clock);
    this.#operations.set(operation.operationId, operation);
    this.#failureSteps.set(operation.operationId, input.failAtStep);
    this.#refreshOperationSnapshot();
    this.#emit();
    return operation;
  }

  advanceOperation(operationId: string): PrototypeOperation {
    const operation = this.#operations.get(operationId);
    if (operation === undefined) throw new Error("PROTOTYPE_OPERATION_NOT_FOUND");
    const advanced = advancePrototypeOperation(operation, this.#failureSteps.get(operationId));
    this.#operations.set(operationId, advanced);
    this.#operationEffects.get(operationId)?.(advanced);
    this.#refreshOperationSnapshot();
    this.#emit();
    return advanced;
  }

  operations(): readonly PrototypeOperation[] {
    return this.#operationSnapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #read<T>(select: (dataset: ReturnType<typeof buildScenario>) => T): Promise<T> {
    if (this.currentScenario === "loading") return new Promise<T>(() => undefined);
    if (this.currentScenario === "network-error") {
      throw new Error("MOCK_DATA_UNAVAILABLE");
    }
    return structuredClone(select(buildScenario(this.currentScenario)));
  }

  #emit(): void {
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }

  #refreshOperationSnapshot(): void {
    this.#operationSnapshot = [...this.#operations.values()].reverse();
  }
}
