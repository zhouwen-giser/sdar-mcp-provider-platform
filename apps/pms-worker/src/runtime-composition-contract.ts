import type { PmsWorkerRuntimeConfig } from "./config.js";

export interface RuntimeCompositionRepositoryContracts {
  readonly jobs: object;
  readonly runtimeDeployments: object;
  readonly runtimeProcesses: object;
  readonly databaseProfiles: object;
  readonly catalogSnapshots: object;
  readonly registrySnapshots: object;
}

export interface RuntimeCompositionDatabasePreparationPort {
  execute(input: {
    readonly providerId: string;
    readonly deploymentId: string;
    readonly operationId: string;
  }): Promise<unknown>;
}

export interface RuntimeCompositionLifecyclePort {
  start(request: object, context: object): Promise<unknown>;
  stop(request: object, context: object): Promise<unknown>;
}

export interface RuntimeCompositionHealthPort {
  probe(input: {
    readonly target: object;
    readonly httpPort: number;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
}

export interface RuntimeCompositionIdentityPort {
  verify(input: {
    readonly expectedProviderId: string;
    readonly target: object;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
}

export interface RuntimeCompositionCatalogRegistryPort {
  close(deployment: object, context: object): Promise<unknown>;
}

export interface RuntimeCompositionSchedulerPort {
  start(): void;
  tick(): Promise<number>;
  stop(): Promise<void>;
}

export interface RuntimeCompositionCleanupPort {
  cleanup(input: {
    readonly deploymentId: string;
    readonly instanceId: string;
    readonly secretRefs: readonly string[];
  }): Promise<void>;
  close(): Promise<void>;
}

export interface PmsWorkerRuntimeCompositionContract {
  readonly config: PmsWorkerRuntimeConfig;
  readonly repositories: RuntimeCompositionRepositoryContracts;
  readonly databasePreparation: RuntimeCompositionDatabasePreparationPort;
  readonly lifecycle: RuntimeCompositionLifecyclePort;
  readonly health: RuntimeCompositionHealthPort;
  readonly identity: RuntimeCompositionIdentityPort;
  readonly catalogRegistry: RuntimeCompositionCatalogRegistryPort;
  readonly scheduler: RuntimeCompositionSchedulerPort;
  readonly cleanup: RuntimeCompositionCleanupPort;
}

export function definePmsWorkerRuntimeCompositionContract(
  input: PmsWorkerRuntimeCompositionContract,
): PmsWorkerRuntimeCompositionContract {
  requireMethods(input.databasePreparation, ["execute"], "databasePreparation");
  requireMethods(input.lifecycle, ["start", "stop"], "lifecycle");
  requireMethods(input.health, ["probe"], "health");
  requireMethods(input.identity, ["verify"], "identity");
  requireMethods(input.catalogRegistry, ["close"], "catalogRegistry");
  requireMethods(input.scheduler, ["start", "tick", "stop"], "scheduler");
  requireMethods(input.cleanup, ["cleanup", "close"], "cleanup");
  for (const [name, repository] of Object.entries(input.repositories)) {
    if (typeof repository !== "object" || repository === null) {
      throw new Error(`PMS_WORKER_RUNTIME_COMPOSITION_INVALID:repositories.${name}`);
    }
  }
  return Object.freeze({
    ...input,
    config: Object.freeze({ ...input.config }),
    repositories: Object.freeze({ ...input.repositories }),
  });
}

function requireMethods(value: object, methods: readonly string[], name: string): void {
  for (const method of methods) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`PMS_WORKER_RUNTIME_COMPOSITION_INVALID:${name}.${method}`);
    }
  }
}
