import {
  advanceOperation as advancePrototypeOperation,
  browserPrototypeClock,
  createOperation,
  type PrototypeClock,
} from "../prototype/operations.js";
import { buildScenario } from "./scenarios.js";
import type {
  DashboardSnapshot,
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
  RuntimeProcessSummary,
  SimulatedOperationInput,
  WorkerJobSummary,
} from "./types.js";

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
    return [...jobs, ...this.#createdJobs.values()];
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
    return this.#read((dataset) => dataset.incidents);
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
