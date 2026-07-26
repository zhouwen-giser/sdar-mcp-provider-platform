export type WorkerLifecycleState = "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface WorkerHealthSnapshot {
  readonly state: WorkerLifecycleState;
  readonly ready: boolean;
  readonly lastSuccessfulLoopAt?: Date;
  readonly failureCode?: string;
}

export class WorkerHealth {
  #state: WorkerLifecycleState = "starting";
  #lastSuccessfulLoopAt?: Date;
  #failureCode: string | undefined;

  ready(): void {
    this.#state = "ready";
    this.#failureCode = undefined;
  }

  loopSucceeded(at = new Date()): void {
    this.#lastSuccessfulLoopAt = new Date(at);
    if (this.#state === "failed") this.#state = "ready";
  }

  stopping(): void {
    this.#state = "stopping";
  }

  stopped(): void {
    this.#state = "stopped";
  }

  failed(code: string): void {
    this.#state = "failed";
    this.#failureCode = code;
  }

  snapshot(): WorkerHealthSnapshot {
    return Object.freeze({
      state: this.#state,
      ready: this.#state === "ready",
      ...(this.#lastSuccessfulLoopAt === undefined
        ? {}
        : { lastSuccessfulLoopAt: new Date(this.#lastSuccessfulLoopAt) }),
      ...(this.#failureCode === undefined ? {} : { failureCode: this.#failureCode }),
    });
  }
}
