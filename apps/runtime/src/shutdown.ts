export const V0_1_ACTIVE_TASK_SHUTDOWN_POLICY = Object.freeze({
  newInvocations: "reject_while_draining",
  activeTasks: "persist_for_same_authority_recovery",
  taskAuthoritySwitch: "forbidden",
} as const);

export type RuntimeDrainState = "accepting" | "draining" | "closed";

export class RuntimeDrainController {
  #state: RuntimeDrainState = "accepting";

  get state(): RuntimeDrainState {
    return this.#state;
  }

  get acceptingInvocations(): boolean {
    return this.#state === "accepting";
  }

  beginDrain(): boolean {
    if (this.#state !== "accepting") return false;
    this.#state = "draining";
    return true;
  }

  closed(): void {
    this.#state = "closed";
  }
}

export interface RuntimeShutdownDependencies {
  readonly beginDrain: () => void;
  readonly stopConfig: () => Promise<void>;
  readonly closeRuntime: () => Promise<void>;
  readonly onBegin?: (signal: string) => void;
}

export function createRuntimeShutdown(
  dependencies: RuntimeShutdownDependencies,
): (signal: string) => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;
  return (signal: string) => {
    shutdownPromise ??= (async () => {
      dependencies.beginDrain();
      dependencies.onBegin?.(signal);
      await dependencies.stopConfig();
      await dependencies.closeRuntime();
    })();
    return shutdownPromise;
  };
}
