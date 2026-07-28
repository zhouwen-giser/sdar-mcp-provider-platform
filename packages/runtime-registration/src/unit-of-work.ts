import type {
  ExpectedRuntimeInstance,
  RuntimeRegistrationReadiness,
  RuntimeRegistrationSnapshot,
} from "./model.js";

export interface RuntimeRegistrationTransactionScope {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
}

export interface ExpectedRuntimeInstancePort {
  getExpected(scope: RuntimeRegistrationTransactionScope): Promise<ExpectedRuntimeInstance | null>;
}

/**
 * This deliberately contains no mutable process-observation fields. Registration
 * owns only the patch below and uses observedRevision as its second CAS token.
 */
export interface RuntimeRegistrationProcessState {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly observedRevision: number;
}

export interface RuntimeRegistrationProcessPort {
  get(scope: RuntimeRegistrationTransactionScope): Promise<RuntimeRegistrationProcessState | null>;
}

export interface RuntimeRegistrationProjectionPatch {
  readonly registrationState: "registered";
  readonly readinessState: RuntimeRegistrationReadiness;
  readonly lastHeartbeatAt: Date;
  readonly runtimeVersion: string;
  readonly configRevision: number;
  readonly observedRevision: number;
}

export interface RuntimeRegistrationStatePort {
  get(scope: RuntimeRegistrationTransactionScope): Promise<RuntimeRegistrationSnapshot | null>;
  insert(
    scope: RuntimeRegistrationTransactionScope,
    registration: RuntimeRegistrationSnapshot,
  ): Promise<void>;
  update(
    scope: RuntimeRegistrationTransactionScope,
    expectedRevision: number,
    registration: RuntimeRegistrationSnapshot,
  ): Promise<void>;
  updateRegistrationProjection(
    scope: RuntimeRegistrationTransactionScope,
    expectedObservedRevision: number,
    patch: RuntimeRegistrationProjectionPatch,
  ): Promise<void>;
}

export interface RuntimeRegistrationAuditEvent {
  readonly action: "runtime.register" | "runtime.heartbeat";
  readonly outcome: "created" | "updated" | "unchanged" | "rejected";
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly subjectId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly reasonCode?: string;
  readonly revision?: number;
}

export interface RuntimeRegistrationAuditPort {
  append(event: RuntimeRegistrationAuditEvent): Promise<void>;
}

export interface RuntimeRegistrationRepositories {
  readonly expectedInstances: ExpectedRuntimeInstancePort;
  readonly processes: RuntimeRegistrationProcessPort;
  readonly registrations: RuntimeRegistrationStatePort;
  readonly audit: RuntimeRegistrationAuditPort;
}

/** A transaction boundary for registration plus its RuntimeProcess projection. */
export interface RuntimeRegistrationUnitOfWork {
  transaction<T>(work: (repositories: RuntimeRegistrationRepositories) => Promise<T>): Promise<T>;
}
