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
  PmsWebDataSource,
  PrototypeOperation,
  PrototypeScenario,
  ProviderSummary,
  RuntimeDeploymentSummary,
  SimulatedOperationInput,
} from "./types.js";

export class MockPmsWebDataSource implements PmsWebDataSource {
  readonly #listeners = new Set<() => void>();
  readonly #operations = new Map<string, PrototypeOperation>();
  readonly #failureSteps = new Map<string, number | undefined>();
  #operationSnapshot: readonly PrototypeOperation[] = [];

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
    return this.#read((dataset) => dataset.providers);
  }

  async deployments(): Promise<readonly RuntimeDeploymentSummary[]> {
    return this.#read((dataset) => dataset.deployments);
  }

  async incidents(): Promise<readonly IncidentSummary[]> {
    return this.#read((dataset) => dataset.incidents);
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
