import type { FastifyRequest } from "fastify";
import type {
  AuditContext,
  CreateProviderInput,
  CreateResourceInput,
  CreateRuntimeDeploymentInput,
  RuntimeDeploymentCommandInput,
} from "../../../../packages/pms-application/src/index.js";
import type {
  CreateConfigurationDraft,
  PublishConfigurationDraft,
  RollbackConfiguration,
  UpdateConfigurationDraft,
} from "../../../../packages/configuration-center/src/index.js";
import type {
  ProviderHostingMode,
  ProviderStatus,
  ResourceStatus,
} from "../../../../packages/pms-domain/src/index.js";
import { requestContext } from "../context.js";
import { ConsoleRequestMappingError } from "./request-mapping-error.js";

export function consoleAuditContext(request: FastifyRequest): AuditContext {
  const actor = request.headers["x-actor-id"];
  if (typeof actor !== "string" || actor.trim().length === 0) {
    throw new ConsoleRequestMappingError("PMS_CONSOLE_ACTOR_ID_INVALID");
  }
  return {
    actorId: actor,
    correlationId: requestContext(request).correlationId,
  };
}

export function mapCreateProvider(body: unknown): CreateProviderInput {
  const value = record(body);
  return {
    providerId: string(value, "providerId"),
    providerTypeId: string(value, "providerTypeId"),
    ...optionalString(value, "packageId"),
    ...optionalString(value, "packageVersion"),
    ...(value.hostingMode === undefined
      ? {}
      : { hostingMode: string(value, "hostingMode") as ProviderHostingMode }),
    ...optionalString(value, "adapterEndpoint"),
  };
}

export function mapProviderStatus(body: unknown): {
  readonly status: ProviderStatus;
  readonly expectedUpdatedAt: Date;
} {
  const value = record(body);
  return {
    status: string(value, "status") as ProviderStatus,
    expectedUpdatedAt: date(value, "expectedUpdatedAt"),
  };
}

export function mapCreateResource(body: unknown): CreateResourceInput {
  const value = record(body);
  return {
    environment: string(value, "environment"),
    resourceId: string(value, "resourceId"),
    resourceType: string(value, "resourceType"),
    metadata: (value.metadata ?? {}) as CreateResourceInput["metadata"],
  };
}

export function mapResourceStatus(body: unknown): {
  readonly status: ResourceStatus;
  readonly expectedUpdatedAt: Date;
} {
  const value = record(body);
  return {
    status: string(value, "status") as ResourceStatus,
    expectedUpdatedAt: date(value, "expectedUpdatedAt"),
  };
}

export function mapCreateConfigurationDraft(body: unknown): CreateConfigurationDraft {
  const value = record(body);
  return {
    draftId: string(value, "draftId"),
    definitionId: string(value, "definitionId"),
    key: {
      environment: string(value, "environment"),
      targetType: string(value, "targetType") as CreateConfigurationDraft["key"]["targetType"],
      targetId: string(value, "targetId"),
      configGroup: string(value, "configGroup"),
      dataId: string(value, "dataId"),
    },
    ...(value.ancestorTargetIds === undefined
      ? {}
      : {
          ancestorTargetIds: value.ancestorTargetIds as NonNullable<
            CreateConfigurationDraft["ancestorTargetIds"]
          >,
        }),
    content: record(value.content) as CreateConfigurationDraft["content"],
  };
}

export function mapUpdateConfigurationDraft(body: unknown): UpdateConfigurationDraft {
  const value = record(body);
  return {
    expectedVersion: integer(value, "expectedVersion"),
    ...(value.ancestorTargetIds === undefined
      ? {}
      : {
          ancestorTargetIds: value.ancestorTargetIds as NonNullable<
            UpdateConfigurationDraft["ancestorTargetIds"]
          >,
        }),
    content: record(value.content) as UpdateConfigurationDraft["content"],
  };
}

export function mapPublishConfiguration(draftId: string, body: unknown): PublishConfigurationDraft {
  const value = record(body);
  return {
    draftId,
    expectedDraftVersion: integer(value, "expectedDraftVersion"),
    expectedPublishedRevision: nullableInteger(value, "expectedPublishedRevision"),
  };
}

export function mapRollbackConfiguration(draftId: string, body: unknown): RollbackConfiguration {
  const value = record(body);
  return {
    ...mapPublishConfiguration(draftId, value),
    sourceRevisionId: string(value, "sourceRevisionId"),
  };
}

export function mapCreateRuntimeDeployment(body: unknown): CreateRuntimeDeploymentInput {
  const value = record(body);
  return {
    deploymentId: string(value, "deploymentId"),
    providerId: string(value, "providerId"),
    environment: string(value, "environment"),
    runtimeVersion: string(value, "runtimeVersion"),
    databaseProfileId: string(value, "databaseProfileId"),
    configProfileId: string(value, "configProfileId"),
    ...optionalString(value, "adapterEndpoint"),
    ...(value.desiredReplicas === undefined
      ? {}
      : { desiredReplicas: integer(value, "desiredReplicas") }),
  };
}

export function mapRuntimeDeploymentCommand(
  deploymentId: string,
  command: RuntimeDeploymentCommandInput["command"],
  body: unknown,
): RuntimeDeploymentCommandInput {
  const value = record(body);
  return {
    providerId: string(value, "providerId"),
    deploymentId,
    command,
    expectedDesiredRevision: integer(value, "expectedDesiredRevision"),
    ...(value.desiredReplicas === undefined
      ? {}
      : { desiredReplicas: integer(value, "desiredReplicas") }),
  };
}

export function requestRecord(value: unknown): Readonly<Record<string, unknown>> {
  return record(value);
}

export function requestString(value: Readonly<Record<string, unknown>>, field: string): string {
  return string(value, field);
}

export function requestInteger(value: Readonly<Record<string, unknown>>, field: string): number {
  return integer(value, field);
}

function optionalString(
  value: Readonly<Record<string, unknown>>,
  field: string,
): Readonly<Record<string, string>> {
  return value[field] === undefined ? {} : { [field]: string(value, field) };
}

function string(value: Readonly<Record<string, unknown>>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string") {
    throw new ConsoleRequestMappingError(`PMS_CONSOLE_STRING_REQUIRED:${field}`);
  }
  return candidate;
}

function integer(value: Readonly<Record<string, unknown>>, field: string): number {
  const candidate = value[field];
  if (!Number.isSafeInteger(candidate)) {
    throw new ConsoleRequestMappingError(`PMS_CONSOLE_INTEGER_REQUIRED:${field}`);
  }
  return candidate as number;
}

function nullableInteger(value: Readonly<Record<string, unknown>>, field: string): number | null {
  return value[field] === null ? null : integer(value, field);
}

function date(value: Readonly<Record<string, unknown>>, field: string): Date {
  const source = string(value, field);
  const candidate = new Date(source);
  if (!Number.isFinite(candidate.getTime())) {
    throw new ConsoleRequestMappingError(`PMS_CONSOLE_DATE_INVALID:${field}`);
  }
  return candidate;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConsoleRequestMappingError("PMS_CONSOLE_OBJECT_REQUIRED");
  }
  return value as Readonly<Record<string, unknown>>;
}
