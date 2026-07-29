import { RuntimeDeploymentError } from "./errors.js";
import type {
  DatabaseProfileId,
  RuntimeConfigProfileId,
  RuntimeDeploymentId,
  RuntimeEnvironmentId,
  RuntimeProviderId,
} from "./ids.js";

export const RUNTIME_DEPLOYMENT_DESIRED_STATES = ["running", "stopped", "draining"] as const;
export type RuntimeDeploymentDesiredState = (typeof RUNTIME_DEPLOYMENT_DESIRED_STATES)[number];

export const RUNTIME_DEPLOYMENT_STATUSES = [
  "REQUESTED",
  "DATABASE_PROVISIONING",
  "MIGRATING",
  "CONFIG_PREPARING",
  "STARTING",
  "HEALTH_CHECKING",
  "DISCOVERING",
  "ACTIVE",
  "STOPPED",
  "DRAINING",
  "DEGRADED",
  "FAILED",
] as const;
export type RuntimeDeploymentStatus = (typeof RUNTIME_DEPLOYMENT_STATUSES)[number];

export interface RuntimeDeploymentSpec {
  readonly deploymentId: RuntimeDeploymentId;
  readonly providerId: RuntimeProviderId;
  readonly environment: RuntimeEnvironmentId;
  readonly desiredState: RuntimeDeploymentDesiredState;
  readonly desiredReplicas: number;
  readonly runtimeVersion: string;
  readonly databaseProfileId: DatabaseProfileId;
  readonly configProfileId: RuntimeConfigProfileId;
  readonly adapterEndpoint?: string;
}

export interface RuntimeDeploymentSnapshot extends RuntimeDeploymentSpec {
  readonly status: RuntimeDeploymentStatus;
  readonly desiredRevision: number;
  readonly observedRevision: number;
}

export interface RuntimeDeploymentTransitionPrecondition {
  readonly expectedStatus: RuntimeDeploymentStatus;
  readonly expectedRevision: number;
}

export type RuntimeDeploymentDomainEvent =
  | {
      readonly type: "RuntimeDeploymentRequested";
      readonly deploymentId: RuntimeDeploymentId;
      readonly providerId: RuntimeProviderId;
      readonly desiredRevision: 0;
      readonly observedRevision: 0;
      readonly occurredAt: Date;
    }
  | {
      readonly type: "RuntimeDeploymentDesiredStateChanged";
      readonly deploymentId: RuntimeDeploymentId;
      readonly previousDesiredState: RuntimeDeploymentDesiredState;
      readonly desiredState: RuntimeDeploymentDesiredState;
      readonly previousDesiredReplicas: number;
      readonly desiredReplicas: number;
      readonly desiredRevision: number;
      readonly occurredAt: Date;
    }
  | {
      readonly type: "RuntimeDeploymentStatusChanged";
      readonly deploymentId: RuntimeDeploymentId;
      readonly previousStatus: RuntimeDeploymentStatus;
      readonly status: RuntimeDeploymentStatus;
      readonly observedRevision: number;
      readonly occurredAt: Date;
    };

const AllowedTransitions: Readonly<
  Record<RuntimeDeploymentStatus, readonly RuntimeDeploymentStatus[]>
> = Object.freeze({
  REQUESTED: ["DATABASE_PROVISIONING", "DRAINING", "STOPPED", "FAILED"],
  DATABASE_PROVISIONING: ["MIGRATING", "DRAINING", "FAILED"],
  MIGRATING: ["CONFIG_PREPARING", "DRAINING", "FAILED"],
  CONFIG_PREPARING: ["STARTING", "DRAINING", "FAILED"],
  STARTING: ["HEALTH_CHECKING", "DRAINING", "FAILED"],
  HEALTH_CHECKING: ["DISCOVERING", "DEGRADED", "DRAINING", "FAILED"],
  DISCOVERING: ["ACTIVE", "DEGRADED", "DRAINING", "FAILED"],
  ACTIVE: ["DEGRADED", "DRAINING", "FAILED"],
  STOPPED: ["CONFIG_PREPARING", "REQUESTED"],
  DRAINING: ["STOPPED", "FAILED"],
  DEGRADED: ["DISCOVERING", "DRAINING", "FAILED"],
  FAILED: ["REQUESTED", "STOPPED"],
});

export class RuntimeDeployment {
  readonly #identity: Pick<
    RuntimeDeploymentSpec,
    | "deploymentId"
    | "providerId"
    | "environment"
    | "runtimeVersion"
    | "databaseProfileId"
    | "configProfileId"
    | "adapterEndpoint"
  >;
  #desiredState: RuntimeDeploymentDesiredState;
  #desiredReplicas: number;
  #status: RuntimeDeploymentStatus;
  #desiredRevision: number;
  #observedRevision: number;
  readonly #events: RuntimeDeploymentDomainEvent[];

  private constructor(snapshot: RuntimeDeploymentSnapshot, events: RuntimeDeploymentDomainEvent[]) {
    validateSpec(snapshot);
    requireRevision(snapshot.desiredRevision, "desiredRevision");
    requireRevision(snapshot.observedRevision, "observedRevision");
    this.#identity = Object.freeze({
      deploymentId: snapshot.deploymentId,
      providerId: snapshot.providerId,
      environment: snapshot.environment,
      runtimeVersion: snapshot.runtimeVersion,
      databaseProfileId: snapshot.databaseProfileId,
      configProfileId: snapshot.configProfileId,
      ...(snapshot.adapterEndpoint === undefined
        ? {}
        : { adapterEndpoint: snapshot.adapterEndpoint }),
    });
    this.#desiredState = snapshot.desiredState;
    this.#desiredReplicas = snapshot.desiredReplicas;
    this.#status = snapshot.status;
    this.#desiredRevision = snapshot.desiredRevision;
    this.#observedRevision = snapshot.observedRevision;
    this.#events = events;
  }

  static request(spec: RuntimeDeploymentSpec, occurredAt: Date): RuntimeDeployment {
    validateSpec(spec);
    requireDate(occurredAt);
    const deployment = new RuntimeDeployment(
      {
        ...spec,
        status: "REQUESTED",
        desiredRevision: 0,
        observedRevision: 0,
      },
      [],
    );
    deployment.#events.push(
      freezeEvent({
        type: "RuntimeDeploymentRequested",
        deploymentId: spec.deploymentId,
        providerId: spec.providerId,
        desiredRevision: 0,
        observedRevision: 0,
        occurredAt,
      }),
    );
    return deployment;
  }

  static rehydrate(snapshot: RuntimeDeploymentSnapshot): RuntimeDeployment {
    return new RuntimeDeployment(snapshot, []);
  }

  get snapshot(): RuntimeDeploymentSnapshot {
    return Object.freeze({
      ...this.#identity,
      desiredState: this.#desiredState,
      desiredReplicas: this.#desiredReplicas,
      status: this.#status,
      desiredRevision: this.#desiredRevision,
      observedRevision: this.#observedRevision,
    });
  }

  changeDesiredState(
    desiredState: RuntimeDeploymentDesiredState,
    desiredReplicas: number,
    expectedRevision: number,
    occurredAt: Date,
  ): boolean {
    validateDesiredState(desiredState, desiredReplicas);
    requireRevision(expectedRevision, "expectedRevision");
    requireDate(occurredAt);
    const unchanged =
      desiredState === this.#desiredState && desiredReplicas === this.#desiredReplicas;
    if (unchanged) {
      assertIdempotentRevision(expectedRevision, this.#desiredRevision, "desired");
      return false;
    }
    assertRevision(expectedRevision, this.#desiredRevision, "desired");

    const previousDesiredState = this.#desiredState;
    const previousDesiredReplicas = this.#desiredReplicas;
    this.#desiredState = desiredState;
    this.#desiredReplicas = desiredReplicas;
    this.#desiredRevision += 1;
    this.#events.push(
      freezeEvent({
        type: "RuntimeDeploymentDesiredStateChanged",
        deploymentId: this.#identity.deploymentId,
        previousDesiredState,
        desiredState,
        previousDesiredReplicas,
        desiredReplicas,
        desiredRevision: this.#desiredRevision,
        occurredAt,
      }),
    );
    return true;
  }

  transition(
    target: RuntimeDeploymentStatus,
    precondition: RuntimeDeploymentTransitionPrecondition,
    occurredAt: Date,
  ): boolean {
    requireRevision(precondition.expectedRevision, "expectedRevision");
    requireDate(occurredAt);
    if (target === this.#status) {
      assertIdempotentTransition(precondition, this.#status, this.#observedRevision);
      return false;
    }
    if (precondition.expectedStatus !== this.#status) {
      throw new RuntimeDeploymentError(
        "RUNTIME_DEPLOYMENT_STATE_CONFLICT",
        "RuntimeDeployment status precondition does not match",
        {
          expectedStatus: precondition.expectedStatus,
          actualStatus: this.#status,
        },
      );
    }
    assertRevision(precondition.expectedRevision, this.#observedRevision, "observed");
    if (!AllowedTransitions[this.#status].includes(target)) {
      throw new RuntimeDeploymentError(
        "INVALID_RUNTIME_DEPLOYMENT_TRANSITION",
        `Invalid RuntimeDeployment transition: ${this.#status} -> ${target}`,
        { currentStatus: this.#status, targetStatus: target },
      );
    }

    const previousStatus = this.#status;
    this.#status = target;
    this.#observedRevision += 1;
    this.#events.push(
      freezeEvent({
        type: "RuntimeDeploymentStatusChanged",
        deploymentId: this.#identity.deploymentId,
        previousStatus,
        status: target,
        observedRevision: this.#observedRevision,
        occurredAt,
      }),
    );
    return true;
  }

  pullDomainEvents(): readonly RuntimeDeploymentDomainEvent[] {
    const events = this.#events.splice(0);
    return Object.freeze(events);
  }
}

export function requestRuntimeDeployment(
  spec: RuntimeDeploymentSpec,
  occurredAt: Date,
): RuntimeDeployment {
  return RuntimeDeployment.request(spec, occurredAt);
}

export function rehydrateRuntimeDeployment(snapshot: RuntimeDeploymentSnapshot): RuntimeDeployment {
  return RuntimeDeployment.rehydrate(snapshot);
}

function validateSpec(spec: RuntimeDeploymentSpec): void {
  if (spec.runtimeVersion.trim().length === 0) invalidSpec("runtimeVersion");
  if (spec.adapterEndpoint?.trim().length === 0) {
    invalidSpec("adapterEndpoint");
  }
  validateDesiredState(spec.desiredState, spec.desiredReplicas);
}

function validateDesiredState(
  desiredState: RuntimeDeploymentDesiredState,
  desiredReplicas: number,
): void {
  if (!RUNTIME_DEPLOYMENT_DESIRED_STATES.includes(desiredState)) invalidSpec("desiredState");
  if (!Number.isSafeInteger(desiredReplicas) || desiredReplicas < 0 || desiredReplicas > 1) {
    invalidSpec("desiredReplicas");
  }
  if (desiredState === "running" && desiredReplicas !== 1) invalidSpec("desiredReplicas");
  if (desiredState !== "running" && desiredReplicas !== 0) invalidSpec("desiredReplicas");
}

function assertRevision(expected: number, actual: number, revisionKind: string): void {
  if (expected !== actual) {
    throw new RuntimeDeploymentError(
      "RUNTIME_DEPLOYMENT_REVISION_CONFLICT",
      `RuntimeDeployment ${revisionKind} revision precondition does not match`,
      { revisionKind, expectedRevision: expected, actualRevision: actual },
    );
  }
}

function assertIdempotentRevision(expected: number, actual: number, revisionKind: string): void {
  if (expected !== actual && expected !== actual - 1) {
    assertRevision(expected, actual, revisionKind);
  }
}

function assertIdempotentTransition(
  precondition: RuntimeDeploymentTransitionPrecondition,
  actualStatus: RuntimeDeploymentStatus,
  actualRevision: number,
): void {
  if (
    precondition.expectedStatus === actualStatus &&
    precondition.expectedRevision === actualRevision
  ) {
    return;
  }
  if (
    precondition.expectedRevision === actualRevision - 1 &&
    AllowedTransitions[precondition.expectedStatus].includes(actualStatus)
  ) {
    return;
  }
  if (precondition.expectedStatus !== actualStatus) {
    throw new RuntimeDeploymentError(
      "RUNTIME_DEPLOYMENT_STATE_CONFLICT",
      "RuntimeDeployment status precondition does not match",
      {
        expectedStatus: precondition.expectedStatus,
        actualStatus,
      },
    );
  }
  assertRevision(precondition.expectedRevision, actualRevision, "observed");
}

function requireRevision(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) invalidSpec(field);
}

function requireDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) invalidSpec("occurredAt");
}

function invalidSpec(field: string): never {
  throw new RuntimeDeploymentError(
    "INVALID_RUNTIME_DEPLOYMENT_SPEC",
    `Invalid RuntimeDeployment specification: ${field}`,
    { field },
  );
}

function freezeEvent(event: RuntimeDeploymentDomainEvent): RuntimeDeploymentDomainEvent {
  switch (event.type) {
    case "RuntimeDeploymentRequested":
      return Object.freeze({ ...event, occurredAt: new Date(event.occurredAt) });
    case "RuntimeDeploymentDesiredStateChanged":
      return Object.freeze({ ...event, occurredAt: new Date(event.occurredAt) });
    case "RuntimeDeploymentStatusChanged":
      return Object.freeze({ ...event, occurredAt: new Date(event.occurredAt) });
  }
}
