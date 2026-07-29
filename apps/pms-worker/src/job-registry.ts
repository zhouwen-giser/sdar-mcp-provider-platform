import type { JobLease, LeaseIdentity } from "../../../packages/pms-domain/src/index.js";

export interface PmsJobExecutionContext {
  readonly signal: AbortSignal;
  readonly leaseIdentity: LeaseIdentity;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly leaseExpiresAt: () => Date;
}

export interface PmsJobHandler {
  readonly jobType: string;
  execute(lease: JobLease, context: PmsJobExecutionContext): Promise<void>;
}

export class PmsJobRegistry {
  readonly #handlers = new Map<string, PmsJobHandler>();

  constructor(handlers: readonly PmsJobHandler[] = []) {
    for (const handler of handlers) this.register(handler);
  }

  register(handler: PmsJobHandler): void {
    if (!/^[a-z][a-z0-9._-]{0,127}$/.test(handler.jobType)) {
      throw new Error("PMS_JOB_TYPE_INVALID");
    }
    if (this.#handlers.has(handler.jobType)) throw new Error("PMS_JOB_HANDLER_DUPLICATE");
    this.#handlers.set(handler.jobType, handler);
  }

  get(jobType: string): PmsJobHandler | undefined {
    return this.#handlers.get(jobType);
  }

  jobTypes(): readonly string[] {
    return [...this.#handlers.keys()].sort();
  }
}
