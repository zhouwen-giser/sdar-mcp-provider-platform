import { randomUUID } from "node:crypto";
import {
  auditEventId,
  createAuditEvent,
  type AuditRepository,
  type EnqueueJob,
} from "../../pms-domain/src/index.js";
import {
  databaseProfileId,
  requestRuntimeDeployment,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeProviderId,
  type RuntimeDeployment,
  type RuntimeDeploymentDesiredState,
  type RuntimeDeploymentSnapshot,
} from "../../runtime-deployment/src/index.js";
import { requireAuditContext, type AuditContext } from "./audit-service.js";

export type RuntimeDeploymentApplicationErrorCode =
  | "RUNTIME_DEPLOYMENT_NOT_FOUND"
  | "RUNTIME_DEPLOYMENT_PROVIDER_UNAVAILABLE"
  | "RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE"
  | "RUNTIME_DEPLOYMENT_DATABASE_PROFILE_UNAVAILABLE"
  | "RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED"
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
  databaseProfileAvailable(databaseProfileId: string): Promise<boolean>;
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
  readonly jobs: RuntimeDeploymentJobPort;
  readonly audit: AuditRepository;
}

export interface RuntimeDeploymentApplicationUnitOfWork {
  transaction<T>(
    work: (repositories: RuntimeDeploymentApplicationRepositories) => Promise<T>,
  ): Promise<T>;
}

export interface CreateRuntimeDeploymentInput {
  readonly deploymentId: string;
  readonly providerId: string;
  readonly environment: string;
  readonly runtimeVersion: string;
  readonly databaseProfileId: string;
  readonly configProfileId: string;
  readonly adapterEndpoint?: string;
  readonly desiredReplicas?: number;
}

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
    const aggregate = requestRuntimeDeployment(
      {
        deploymentId: runtimeDeploymentId(input.deploymentId),
        providerId: runtimeProviderId(input.providerId),
        environment: runtimeEnvironmentId(input.environment),
        desiredState: "running",
        desiredReplicas,
        runtimeVersion: input.runtimeVersion,
        databaseProfileId: databaseProfileId(input.databaseProfileId),
        configProfileId: runtimeConfigProfileId(input.configProfileId),
        ...(input.adapterEndpoint === undefined ? {} : { adapterEndpoint: input.adapterEndpoint }),
      },
      this.#now(),
    );
    return this.unitOfWork.transaction(async (repositories) => {
      await repositories.deployments.insert(aggregate.snapshot);
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
    if (!(await this.prerequisites.configProfileAvailable(input.configProfileId))) {
      unavailable(
        "RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE",
        "Config profile is unavailable for RuntimeDeployment",
      );
    }
    if (!(await this.prerequisites.databaseProfileAvailable(input.databaseProfileId))) {
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
