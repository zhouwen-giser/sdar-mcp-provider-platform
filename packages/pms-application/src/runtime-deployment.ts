import { randomUUID } from "node:crypto";
import {
  auditEventId,
  createAuditEvent,
  type AuditRepository,
  type EnqueueJob,
} from "../../pms-domain/src/index.js";
import {
  databaseProfileId,
  createRuntimeProcessProjection,
  requestRuntimeDeployment,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeInstanceId,
  runtimeProviderId,
  type RuntimeDeployment,
  type RuntimeDeploymentDesiredState,
  type RuntimeProcessProjection,
  type RuntimeDeploymentSnapshot,
} from "../../runtime-deployment/src/index.js";
import { requireAuditContext, type AuditContext } from "./audit-service.js";
import { parseRuntimeConfigProfileLocator } from "./runtime-config-profile-locator.js";

export type RuntimeDeploymentApplicationErrorCode =
  | "RUNTIME_DEPLOYMENT_NOT_FOUND"
  | "RUNTIME_DEPLOYMENT_PROVIDER_UNAVAILABLE"
  | "RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE"
  | "RUNTIME_DEPLOYMENT_DATABASE_PROFILE_UNAVAILABLE"
  | "RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED"
  | "RUNTIME_DEPLOYMENT_COMMAND_UNSUPPORTED"
  | "RUNTIME_DEPLOYMENT_REVISION_CONFLICT";

export class RuntimeDeploymentApplicationError extends Error {
  constructor(
    readonly code: RuntimeDeploymentApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeDeploymentApplicationError";
  }
}

export interface RuntimeDeploymentPrerequisitePort {
  providerAvailable(providerId: string): Promise<boolean>;
  configProfileAvailable(configProfileId: string): Promise<boolean>;
  databaseProfileAvailable(input: RuntimeDeploymentDatabaseProfilePrerequisite): Promise<boolean>;
}

export interface RuntimeDeploymentDatabaseProfilePrerequisite {
  readonly databaseProfileId: string;
  readonly providerId: string;
  readonly environment: string;
}

export interface RuntimeDeploymentRepositoryPort {
  get(providerId: string, deploymentId: string): Promise<RuntimeDeployment | null>;
  insert(value: RuntimeDeploymentSnapshot): Promise<void>;
  save(
    value: RuntimeDeploymentSnapshot,
    precondition: {
      readonly expectedDesiredRevision: number;
      readonly expectedObservedRevision: number;
    },
  ): Promise<boolean>;
}

export interface RuntimeDeploymentJobPort {
  enqueue(job: EnqueueJob): Promise<void>;
}

export interface RuntimeDeploymentApplicationRepositories {
  readonly deployments: RuntimeDeploymentRepositoryPort;
  readonly processes: RuntimeDeploymentExpectedProcessPort;
  readonly jobs: RuntimeDeploymentJobPort;
  readonly audit: AuditRepository;
}

export interface RuntimeDeploymentExpectedProcessPort {
  insertExpected(providerId: string, value: RuntimeProcessProjection): Promise<void>;
}

export interface RuntimeDeploymentApplicationUnitOfWork {
  transaction<T>(
    work: (repositories: RuntimeDeploymentApplicationRepositories) => Promise<T>,
  ): Promise<T>;
}

interface CreateRuntimeDeploymentInputBase {
  readonly deploymentId: string;
  readonly providerId: string;
  readonly environment: string;
  readonly runtimeVersion: string;
  readonly adapterEndpoint?: string;
  readonly desiredReplicas?: number;
}

export interface CreatePlatformManagedRuntimeDeploymentInput extends CreateRuntimeDeploymentInputBase {
  readonly runtimeAuthority?: "platform_managed";
  readonly databaseProfileId: string;
  readonly configProfileId: string;
  readonly directContainer?: never;
}

export interface CreateDirectContainerRuntimeDeploymentInput extends CreateRuntimeDeploymentInputBase {
  readonly runtimeAuthority: "direct_container";
  readonly adapterEndpoint: string;
  readonly databaseProfileId?: never;
  readonly configProfileId?: never;
  readonly directContainer: {
    readonly instanceId: string;
    readonly controlEndpoint: string;
    readonly advertisedEndpoint: string;
  };
}

export type CreateRuntimeDeploymentInput =
  CreatePlatformManagedRuntimeDeploymentInput | CreateDirectContainerRuntimeDeploymentInput;

export type RuntimeDeploymentCommandType = "start" | "stop" | "restart" | "scale" | "reconcile";

export interface RuntimeDeploymentCommandInput {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly command: RuntimeDeploymentCommandType;
  readonly expectedDesiredRevision: number;
  readonly desiredReplicas?: number;
}

export interface RuntimeDeploymentApplicationOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class RuntimeDeploymentApplicationService {
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(
    private readonly unitOfWork: RuntimeDeploymentApplicationUnitOfWork,
    private readonly prerequisites: RuntimeDeploymentPrerequisitePort,
    options: RuntimeDeploymentApplicationOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  async create(
    input: CreateRuntimeDeploymentInput,
    context: AuditContext,
  ): Promise<RuntimeDeploymentSnapshot> {
    requireAuditContext(context);
    const desiredReplicas = input.desiredReplicas ?? 1;
    assertReplicaCount(desiredReplicas);
    await this.#validatePrerequisites(input);
    const common = {
      deploymentId: runtimeDeploymentId(input.deploymentId),
      providerId: runtimeProviderId(input.providerId),
      environment: runtimeEnvironmentId(input.environment),
      desiredState: "running",
      desiredReplicas,
      runtimeVersion: input.runtimeVersion,
      ...(input.adapterEndpoint === undefined ? {} : { adapterEndpoint: input.adapterEndpoint }),
    } as const;
    const aggregate = requestRuntimeDeployment(
      input.runtimeAuthority === "direct_container"
        ? {
            ...common,
            runtimeAuthority: "direct_container",
            adapterEndpoint: input.adapterEndpoint,
            directContainer: {
              instanceId: runtimeInstanceId(input.directContainer.instanceId),
              controlEndpoint: input.directContainer.controlEndpoint,
              advertisedEndpoint: input.directContainer.advertisedEndpoint,
            },
          }
        : {
            ...common,
            runtimeAuthority: "platform_managed",
            databaseProfileId: databaseProfileId(input.databaseProfileId),
            configProfileId: runtimeConfigProfileId(input.configProfileId),
          },
      this.#now(),
    );
    return this.unitOfWork.transaction(async (repositories) => {
      await repositories.deployments.insert(aggregate.snapshot);
      if (aggregate.snapshot.runtimeAuthority === "direct_container") {
        const direct = aggregate.snapshot.directContainer;
        await repositories.processes.insertExpected(
          input.providerId,
          createRuntimeProcessProjection(
            {
              instanceId: direct.instanceId,
              deploymentId: aggregate.snapshot.deploymentId,
              processManager: "direct_container",
              pm2Name: null,
              port: null,
              controlEndpoint: direct.controlEndpoint,
              advertisedEndpoint: direct.advertisedEndpoint,
            },
            {
              pid: null,
              processState: "missing",
              livenessState: "unknown",
              readinessState: "unknown",
              registrationState: "unregistered",
              catalogState: "unknown",
              configState: "externally_managed",
              lastHeartbeatAt: null,
              runtimeVersion: null,
              configRevision: 0,
              restartCount: 0,
            },
          ),
        );
      }
      await repositories.jobs.enqueue(
        this.#job(input.deploymentId, input.providerId, "create", context),
      );
      await repositories.audit.append(
        this.#audit("runtime_deployment.created", input.deploymentId, context, desiredReplicas),
      );
      return aggregate.snapshot;
    });
  }

  async command(
    input: RuntimeDeploymentCommandInput,
    context: AuditContext,
  ): Promise<RuntimeDeploymentSnapshot> {
    requireAuditContext(context);
    return this.unitOfWork.transaction(async (repositories) => {
      const aggregate = await repositories.deployments.get(input.providerId, input.deploymentId);
      if (aggregate === null) {
        throw new RuntimeDeploymentApplicationError(
          "RUNTIME_DEPLOYMENT_NOT_FOUND",
          "RuntimeDeployment does not exist in Provider scope",
        );
      }
      const before = aggregate.snapshot;
      if (before.runtimeAuthority === "direct_container" && input.command !== "reconcile") {
        unavailable(
          "RUNTIME_DEPLOYMENT_COMMAND_UNSUPPORTED",
          "Direct-container Runtime lifecycle is controlled outside PMS; only reconcile is supported",
        );
      }
      const desired = commandDesiredState(input, before.desiredReplicas);
      if (desired === null && input.expectedDesiredRevision !== before.desiredRevision) {
        unavailable(
          "RUNTIME_DEPLOYMENT_REVISION_CONFLICT",
          "RuntimeDeployment desired revision precondition does not match",
        );
      }
      const changed =
        desired === null
          ? false
          : aggregate.changeDesiredState(
              desired.state,
              desired.replicas,
              input.expectedDesiredRevision,
              this.#now(),
            );
      if (changed) {
        await repositories.deployments.save(aggregate.snapshot, {
          expectedDesiredRevision: before.desiredRevision,
          expectedObservedRevision: before.observedRevision,
        });
      } else if (input.expectedDesiredRevision !== before.desiredRevision) {
        unavailable(
          "RUNTIME_DEPLOYMENT_REVISION_CONFLICT",
          "RuntimeDeployment desired revision precondition does not match",
        );
      }
      await repositories.jobs.enqueue(
        this.#job(input.deploymentId, input.providerId, input.command, context),
      );
      await repositories.audit.append(
        this.#audit(
          `runtime_deployment.${input.command}_requested`,
          input.deploymentId,
          context,
          aggregate.snapshot.desiredReplicas,
        ),
      );
      return aggregate.snapshot;
    });
  }

  async #validatePrerequisites(input: CreateRuntimeDeploymentInput): Promise<void> {
    if (!(await this.prerequisites.providerAvailable(input.providerId))) {
      unavailable(
        "RUNTIME_DEPLOYMENT_PROVIDER_UNAVAILABLE",
        "Provider is unavailable for RuntimeDeployment",
      );
    }
    if (input.runtimeAuthority === "direct_container") return;
    let locator: ReturnType<typeof parseRuntimeConfigProfileLocator>;
    try {
      locator = parseRuntimeConfigProfileLocator(input.configProfileId);
    } catch {
      unavailable(
        "RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE",
        "Config profile is unavailable for RuntimeDeployment",
      );
    }
    if (locator.environment !== input.environment) {
      unavailable(
        "RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE",
        "Config profile is unavailable for RuntimeDeployment",
      );
    }
    if (!(await this.prerequisites.configProfileAvailable(input.configProfileId))) {
      unavailable(
        "RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE",
        "Config profile is unavailable for RuntimeDeployment",
      );
    }
    if (
      !(await this.prerequisites.databaseProfileAvailable({
        databaseProfileId: input.databaseProfileId,
        providerId: input.providerId,
        environment: input.environment,
      }))
    ) {
      unavailable(
        "RUNTIME_DEPLOYMENT_DATABASE_PROFILE_UNAVAILABLE",
        "Database profile is unavailable for RuntimeDeployment",
      );
    }
  }

  #job(
    deploymentId: string,
    providerId: string,
    command: RuntimeDeploymentCommandType | "create",
    context: AuditContext,
  ): EnqueueJob {
    return {
      jobId: this.#newId(),
      jobType: "runtime_deployment.reconcile",
      payload: {
        deploymentId,
        providerId,
        intent: command,
        correlationId: context.correlationId,
      },
    };
  }

  #audit(action: string, deploymentId: string, context: AuditContext, desiredReplicas: number) {
    return createAuditEvent({
      auditEventId: auditEventId(this.#newId()),
      action,
      actorId: context.actorId,
      correlationId: context.correlationId,
      subjectType: "runtime_deployment",
      subjectId: deploymentId,
      occurredAt: this.#now(),
      metadata: { desiredReplicas },
    });
  }
}

function commandDesiredState(
  input: RuntimeDeploymentCommandInput,
  currentReplicas: number,
): { readonly state: RuntimeDeploymentDesiredState; readonly replicas: number } | null {
  switch (input.command) {
    case "start":
      return { state: "running", replicas: 1 };
    case "stop":
      return { state: "draining", replicas: 0 };
    case "scale": {
      const replicas = input.desiredReplicas;
      if (replicas === undefined) {
        unavailable(
          "RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED",
          "Scale requires an explicit supported replica count",
        );
      }
      assertReplicaCount(replicas);
      return replicas === 0
        ? { state: "draining", replicas: 0 }
        : { state: "running", replicas: 1 };
    }
    case "restart":
    case "reconcile":
      void currentReplicas;
      return null;
  }
}

function assertReplicaCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1) {
    unavailable(
      "RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED",
      "V0.1 supports at most one Runtime replica without a stable gateway",
    );
  }
}

function unavailable(code: RuntimeDeploymentApplicationErrorCode, message: string): never {
  throw new RuntimeDeploymentApplicationError(code, message);
}
