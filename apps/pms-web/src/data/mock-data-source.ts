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
  RuntimeDeploymentSummary,
  SimulatedOperationInput,
} from "./types.js";

export class MockPmsWebDataSource implements PmsWebDataSource {
  readonly #listeners = new Set<() => void>();
  readonly #operations = new Map<string, PrototypeOperation>();
  readonly #failureSteps = new Map<string, number | undefined>();
  #operationSnapshot: readonly PrototypeOperation[] = [];
  readonly #onboardedProviders = new Map<string, ProviderSummary>();

  constructor(
    private currentScenario: PrototypeScenario = "healthy",
    private readonly clock: PrototypeClock = browserPrototypeClock,
  ) {}

  scenario(): PrototypeScenario {
    return this.currentScenario;
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
    return this.#read((dataset) => dataset.deployments);
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
    for (const listener of this.#listeners) listener();
  }

  #refreshOperationSnapshot(): void {
    this.#operationSnapshot = [...this.#operations.values()].reverse();
  }
}
