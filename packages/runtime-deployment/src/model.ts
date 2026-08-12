import { RuntimeDeploymentError } from "./errors.js";
import type {
  DatabaseProfileId,
  RuntimeConfigProfileId,
  RuntimeDeploymentId,
  RuntimeEnvironmentId,
  RuntimeInstanceId,
  RuntimeProviderId,
} from "./ids.js";

export const RUNTIME_DEPLOYMENT_DESIRED_STATES = ["running", "stopped", "draining"] as const;
export type RuntimeDeploymentDesiredState = (typeof RUNTIME_DEPLOYMENT_DESIRED_STATES)[number];

export const RUNTIME_DEPLOYMENT_AUTHORITIES = ["platform_managed", "direct_container"] as const;
export type RuntimeDeploymentAuthority = (typeof RUNTIME_DEPLOYMENT_AUTHORITIES)[number];

export interface DirectContainerRuntimeDeploymentSpec {
  readonly instanceId: RuntimeInstanceId;
  /** PMS-only base URL. It must not include the MCP `/mcp` suffix. */
  readonly controlEndpoint: string;
  /** Consumer-reachable base URL. It must not include the MCP `/mcp` suffix. */
  readonly advertisedEndpoint: string;
}

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

interface RuntimeDeploymentSpecBase {
  readonly deploymentId: RuntimeDeploymentId;
  readonly providerId: RuntimeProviderId;
  readonly environment: RuntimeEnvironmentId;
  readonly desiredState: RuntimeDeploymentDesiredState;
  readonly desiredReplicas: number;
  readonly runtimeVersion: string;
  readonly adapterEndpoint?: string;
}

export interface PlatformManagedRuntimeDeploymentSpec extends RuntimeDeploymentSpecBase {
  /** Omission preserves the V0.1 platform-managed create contract. */
  readonly runtimeAuthority?: "platform_managed";
  readonly databaseProfileId: DatabaseProfileId;
  readonly configProfileId: RuntimeConfigProfileId;
  readonly directContainer?: never;
}

export interface DirectContainerRuntimeDeployment extends RuntimeDeploymentSpecBase {
  readonly runtimeAuthority: "direct_container";
  readonly adapterEndpoint: string;
  readonly databaseProfileId?: never;
  readonly configProfileId?: never;
  readonly directContainer: DirectContainerRuntimeDeploymentSpec;
}

export type RuntimeDeploymentSpec =
  PlatformManagedRuntimeDeploymentSpec | DirectContainerRuntimeDeployment;

type NormalizedRuntimeDeploymentSpec =
  | (Omit<PlatformManagedRuntimeDeploymentSpec, "runtimeAuthority"> & {
      readonly runtimeAuthority: "platform_managed";
    })
  | DirectContainerRuntimeDeployment;

export type RuntimeDeploymentSnapshot = NormalizedRuntimeDeploymentSpec & {
  readonly status: RuntimeDeploymentStatus;
  readonly desiredRevision: number;
  readonly observedRevision: number;
};

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
  readonly #identity: Omit<NormalizedRuntimeDeploymentSpec, "desiredState" | "desiredReplicas">;
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
    const common = {
      deploymentId: snapshot.deploymentId,
      providerId: snapshot.providerId,
      environment: snapshot.environment,
      runtimeVersion: snapshot.runtimeVersion,
      ...(snapshot.adapterEndpoint === undefined
        ? {}
        : { adapterEndpoint: snapshot.adapterEndpoint }),
    };
    this.#identity =
      snapshot.runtimeAuthority === "direct_container"
        ? Object.freeze({
            ...common,
            runtimeAuthority: "direct_container",
            directContainer: Object.freeze({ ...snapshot.directContainer }),
          })
        : Object.freeze({
            ...common,
            runtimeAuthority: "platform_managed",
            databaseProfileId: snapshot.databaseProfileId,
            configProfileId: snapshot.configProfileId,
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
    const normalized: RuntimeDeploymentSnapshot =
      spec.runtimeAuthority === "direct_container"
        ? {
            ...spec,
            status: "REQUESTED",
            desiredRevision: 0,
            observedRevision: 0,
          }
        : {
            ...spec,
            runtimeAuthority: "platform_managed",
            status: "REQUESTED",
            desiredRevision: 0,
            observedRevision: 0,
          };
    const deployment = new RuntimeDeployment(normalized, []);
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
    }) as RuntimeDeploymentSnapshot;
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
      assertIdempotentTransition(
        precondition,
        this.#status,
        this.#observedRevision,
        this.#identity.runtimeAuthority,
      );
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
    if (!allowedTransitions(this.#status, this.#identity.runtimeAuthority).includes(target)) {
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
  const raw = spec as unknown as {
    readonly runtimeAuthority?: unknown;
    readonly adapterEndpoint?: unknown;
    readonly databaseProfileId?: unknown;
    readonly configProfileId?: unknown;
    readonly directContainer?: unknown;
  };
  const authority = raw.runtimeAuthority ?? "platform_managed";
  if (authority !== "platform_managed" && authority !== "direct_container") {
    invalidSpec("runtimeAuthority");
  }
  if (authority === "direct_container") {
    const direct = raw.directContainer;
    if (typeof direct !== "object" || direct === null) invalidSpec("directContainer");
    if (typeof raw.adapterEndpoint !== "string") invalidSpec("adapterEndpoint");
    if (raw.databaseProfileId !== undefined) invalidSpec("databaseProfileId");
    if (raw.configProfileId !== undefined) invalidSpec("configProfileId");
    const instanceId = Reflect.get(direct, "instanceId") as unknown;
    const controlEndpoint = Reflect.get(direct, "controlEndpoint") as unknown;
    const advertisedEndpoint = Reflect.get(direct, "advertisedEndpoint") as unknown;
    if (typeof instanceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(instanceId)) {
      invalidSpec("directContainer.instanceId");
    }
    if (typeof controlEndpoint !== "string") invalidSpec("directContainer.controlEndpoint");
    if (typeof advertisedEndpoint !== "string") invalidSpec("directContainer.advertisedEndpoint");
    validateBaseEndpoint(controlEndpoint, "directContainer.controlEndpoint");
    validateBaseEndpoint(advertisedEndpoint, "directContainer.advertisedEndpoint");
  } else {
    if (raw.directContainer !== undefined) invalidSpec("directContainer");
    if (raw.databaseProfileId === undefined) invalidSpec("databaseProfileId");
    if (raw.configProfileId === undefined) invalidSpec("configProfileId");
  }
  validateDesiredState(spec.desiredState, spec.desiredReplicas);
}

function validateBaseEndpoint(value: string, field: string): void {
  if (value.trim() !== value || value.length === 0 || value.length > 2_048) invalidSpec(field);
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    invalidSpec(field);
  }
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username.length > 0 ||
    endpoint.password.length > 0 ||
    endpoint.search.length > 0 ||
    endpoint.hash.length > 0 ||
    endpoint.pathname !== "/"
  ) {
    invalidSpec(field);
  }
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
  authority: RuntimeDeploymentAuthority,
): void {
  if (
    precondition.expectedStatus === actualStatus &&
    precondition.expectedRevision === actualRevision
  ) {
    return;
  }
  if (
    precondition.expectedRevision === actualRevision - 1 &&
    allowedTransitions(precondition.expectedStatus, authority).includes(actualStatus)
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

function allowedTransitions(
  current: RuntimeDeploymentStatus,
  authority: RuntimeDeploymentAuthority,
): readonly RuntimeDeploymentStatus[] {
  if (authority === "direct_container" && current === "REQUESTED") {
    return ["CONFIG_PREPARING", "DRAINING", "STOPPED", "FAILED"];
  }
  return AllowedTransitions[current];
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
