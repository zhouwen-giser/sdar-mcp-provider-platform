import { randomUUID } from "node:crypto";
import type {
  GrpcAdapterGateway,
  StartOperationOptions,
} from "../../adapter-protocol/src/index.js";

export type TaskAdapterGateway = Pick<
  GrpcAdapterGateway,
  "checkAvailability" | "getExecution" | "reconcileExecution" | "startOperation"
>;

export interface DiagnosticResponseLossScope {
  operationName: string;
  taskId?: string;
  correlationId?: string;
  executionMode: "simulation";
  ttlMs: number;
}

export interface DiagnosticFaultLease {
  leaseId: string;
  scope: DiagnosticResponseLossScope;
  armedAt: string;
  expiresAt: string;
}

export interface DiagnosticFaultAuditRecord {
  auditId: string;
  leaseId: string;
  action: "armed" | "consumed" | "expired" | "cleared";
  occurredAt: string;
  scope: DiagnosticResponseLossScope;
}

export interface DiagnosticFaultControllerOptions {
  enabled?: boolean;
  runtimeProfile?: "production" | "development" | "test";
  now?: () => Date;
  maximumTtlMs?: number;
}

export class DiagnosticResponseLossError extends Error {
  readonly uncertaintyClass = "response_lost_after_adapter_success" as const;

  constructor(readonly leaseId: string) {
    super("DIAGNOSTIC_ADAPTER_RESPONSE_LOST_AFTER_SUCCESS");
    this.name = "DiagnosticResponseLossError";
  }
}

/** Test-only lease controller; disabled unless explicitly constructed for a test profile. */
export class DiagnosticFaultController {
  readonly #enabled: boolean;
  readonly #runtimeProfile: "production" | "development" | "test";
  readonly #now: () => Date;
  readonly #maximumTtlMs: number;
  readonly #leases = new Map<string, DiagnosticFaultLease>();
  readonly #audit: DiagnosticFaultAuditRecord[] = [];

  constructor(options: DiagnosticFaultControllerOptions = {}) {
    this.#enabled = options.enabled ?? false;
    this.#runtimeProfile = options.runtimeProfile ?? "production";
    this.#now = options.now ?? (() => new Date());
    this.#maximumTtlMs = options.maximumTtlMs ?? 60_000;
  }

  arm(scope: DiagnosticResponseLossScope): DiagnosticFaultLease {
    if (!this.#enabled) throw new Error("DIAGNOSTIC_FAULTS_DISABLED");
    if (this.#runtimeProfile !== "test") throw new Error("DIAGNOSTIC_FAULT_PROFILE_FORBIDDEN");
    if (scope.executionMode !== "simulation") {
      throw new Error("DIAGNOSTIC_FAULT_EXECUTION_MODE_FORBIDDEN");
    }
    if (!Number.isSafeInteger(scope.ttlMs) || scope.ttlMs < 1 || scope.ttlMs > this.#maximumTtlMs) {
      throw new Error("DIAGNOSTIC_FAULT_TTL_INVALID");
    }
    if (forbiddenOperation(scope.operationName)) {
      throw new Error("DIAGNOSTIC_FAULT_OPERATION_FORBIDDEN");
    }
    if (scope.taskId === undefined && scope.correlationId === undefined) {
      throw new Error("DIAGNOSTIC_FAULT_SCOPE_INCOMPLETE");
    }
    this.#expireLeases();
    const now = this.#now();
    const lease: DiagnosticFaultLease = Object.freeze({
      leaseId: randomUUID(),
      scope: Object.freeze({ ...scope }),
      armedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + scope.ttlMs).toISOString(),
    });
    this.#leases.set(lease.leaseId, lease);
    this.#record(lease, "armed", now);
    return lease;
  }

  consume(operationName: string, options: StartOperationOptions = {}): DiagnosticFaultLease | null {
    this.#expireLeases();
    if (options.executionMode !== "simulation" || forbiddenOperation(operationName)) return null;
    for (const lease of this.#leases.values()) {
      if (lease.scope.operationName !== operationName) continue;
      if (lease.scope.taskId !== undefined && lease.scope.taskId !== options.taskId) continue;
      if (
        lease.scope.correlationId !== undefined &&
        lease.scope.correlationId !== options.correlationId
      ) {
        continue;
      }
      this.#leases.delete(lease.leaseId);
      this.#record(lease, "consumed", this.#now());
      return lease;
    }
    return null;
  }

  clearAll(): void {
    const now = this.#now();
    for (const lease of this.#leases.values()) this.#record(lease, "cleared", now);
    this.#leases.clear();
  }

  activeLeases(): readonly DiagnosticFaultLease[] {
    this.#expireLeases();
    return [...this.#leases.values()];
  }

  auditTrail(): readonly DiagnosticFaultAuditRecord[] {
    this.#expireLeases();
    return this.#audit.map((record) => ({ ...record, scope: { ...record.scope } }));
  }

  #expireLeases(): void {
    const now = this.#now();
    for (const lease of this.#leases.values()) {
      if (new Date(lease.expiresAt).getTime() > now.getTime()) continue;
      this.#leases.delete(lease.leaseId);
      this.#record(lease, "expired", now);
    }
  }

  #record(
    lease: DiagnosticFaultLease,
    action: DiagnosticFaultAuditRecord["action"],
    occurredAt: Date,
  ): void {
    this.#audit.push(
      Object.freeze({
        auditId: randomUUID(),
        leaseId: lease.leaseId,
        action,
        occurredAt: occurredAt.toISOString(),
        scope: lease.scope,
      }),
    );
  }
}

export class DiagnosticAdapterGateway implements TaskAdapterGateway {
  constructor(
    readonly delegate: TaskAdapterGateway,
    readonly faults: DiagnosticFaultController,
  ) {}

  checkAvailability: TaskAdapterGateway["checkAvailability"] = (...argumentsValue) =>
    this.delegate.checkAvailability(...argumentsValue);

  getExecution: TaskAdapterGateway["getExecution"] = (...argumentsValue) =>
    this.delegate.getExecution(...argumentsValue);

  reconcileExecution: TaskAdapterGateway["reconcileExecution"] = (...argumentsValue) =>
    this.delegate.reconcileExecution(...argumentsValue);

  startOperation: TaskAdapterGateway["startOperation"] = async (
    operationName,
    argumentsValue,
    options,
  ) => {
    const normalizedOptions = options ?? {};
    const response = await this.delegate.startOperation(
      operationName,
      argumentsValue,
      normalizedOptions,
    );
    const lease = this.faults.consume(operationName, normalizedOptions);
    if (lease !== null) throw new DiagnosticResponseLossError(lease.leaseId);
    return response;
  };
}

function forbiddenOperation(operationName: string): boolean {
  return /(?:^|[._/-])(?:fire|weapon|shoot|missile|armament)(?:$|[._/-])/iu.test(operationName);
}
