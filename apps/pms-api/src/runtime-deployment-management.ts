import type { Pool } from "pg";
import type {
  AuditContext,
  CreateRuntimeDeploymentInput,
  RuntimeDeploymentApplicationService,
  RuntimeDeploymentCommandInput,
} from "../../../packages/pms-application/src/index.js";
import type { RuntimeDeploymentStatus } from "../../../packages/runtime-deployment/src/index.js";
import type { PostgresRuntimeDeploymentRepository } from "../../../packages/pms-persistence-postgres/src/index.js";
import { PostgresRuntimeDeploymentRepository as Repo } from "../../../packages/pms-persistence-postgres/src/runtime-deployment-repositories.js";
import type {
  RuntimeDeploymentListQuery,
  RuntimeDeploymentListResult,
  RuntimeDeploymentManagementPort,
  RuntimeDeploymentView,
} from "./runtime-deployment-routes.js";

export class RuntimeDeploymentManagementFacade implements RuntimeDeploymentManagementPort {
  constructor(
    private readonly pool: Pool,
    private readonly applicationService: RuntimeDeploymentApplicationService,
  ) {}

  async create(
    input: CreateRuntimeDeploymentInput,
    context: AuditContext,
  ): Promise<RuntimeDeploymentView> {
    const snapshot = await this.applicationService.create(input, context);
    return toView(snapshot);
  }

  async command(
    input: RuntimeDeploymentCommandInput,
    context: AuditContext,
  ): Promise<RuntimeDeploymentView> {
    const snapshot = await this.applicationService.command(input, context);
    return toView(snapshot);
  }

  async get(providerId: string, deploymentId: string): Promise<RuntimeDeploymentView | null> {
    const repo = new Repo(this.pool);
    const deployment = await repo.get(providerId, deploymentId);
    return deployment === null ? null : toView(deployment.snapshot);
  }

  async list(query: RuntimeDeploymentListQuery): Promise<RuntimeDeploymentListResult> {
    const repo = new Repo(this.pool);
    const page = await repo.listByProviderPaged({
      providerId: query.providerId,
      ...(query.environment === undefined ? {} : { environment: query.environment }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    return {
      items: page.items.map((d) => toView(d.snapshot)),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  }
}

function toView(snapshot: {
  readonly deploymentId: string;
  readonly providerId: string;
  readonly environment: string;
  readonly desiredState: string;
  readonly desiredReplicas: number;
  readonly runtimeVersion: string;
  readonly databaseProfileId: string;
  readonly configProfileId: string;
  readonly adapterEndpoint?: string;
  readonly status: RuntimeDeploymentStatus;
  readonly desiredRevision: number;
  readonly observedRevision: number;
}): RuntimeDeploymentView {
  return Object.freeze({
    deploymentId: snapshot.deploymentId,
    providerId: snapshot.providerId,
    environment: snapshot.environment,
    desiredState: snapshot.desiredState as RuntimeDeploymentView["desiredState"],
    desiredReplicas: snapshot.desiredReplicas,
    runtimeVersion: snapshot.runtimeVersion,
    databaseProfileId: snapshot.databaseProfileId,
    configProfileId: snapshot.configProfileId,
    ...(snapshot.adapterEndpoint === undefined
      ? {}
      : { adapterEndpoint: snapshot.adapterEndpoint }),
    status: snapshot.status,
    desiredRevision: snapshot.desiredRevision,
    observedRevision: snapshot.observedRevision,
  });
}

export type { PostgresRuntimeDeploymentRepository };
export type {
  RuntimeDeploymentManagementPort,
  RuntimeDeploymentView,
  RuntimeDeploymentListQuery,
  RuntimeDeploymentListResult,
};
