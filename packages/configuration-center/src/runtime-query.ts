import {
  environmentId,
  type ConfigurationTarget,
  type JsonObject,
  type PmsUnitOfWork,
} from "@sdar/pms-domain";
import { ConfigurationCenterError } from "./errors.js";

export interface RuntimeConfigClientRequest {
  readonly environment: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly configGroup: string;
  readonly dataId: string;
}

export interface RuntimeConfigClientIdentity {
  readonly environment: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly providerId: string;
}

export interface RuntimeConfigClientCredentials {
  readonly authorization?: string;
}

export interface RuntimeConfigClientAuthorizer {
  authorize(
    credentials: RuntimeConfigClientCredentials,
    request: RuntimeConfigClientRequest,
  ): Promise<RuntimeConfigClientIdentity>;
}

export class DenyRuntimeConfigClientAuthorizer implements RuntimeConfigClientAuthorizer {
  authorize(): Promise<RuntimeConfigClientIdentity> {
    return Promise.reject(
      new ConfigurationCenterError(
        "RUNTIME_CONFIG_UNAUTHORIZED",
        "Runtime Config client authentication is not configured",
      ),
    );
  }
}

export interface RuntimeConfigLatest {
  readonly revisionId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly applyMode: "hot_reload" | "reconnect_required" | "restart_required" | "immutable";
  readonly sourceTargetType: "runtime_deployment" | "runtime_instance";
  readonly identity: RuntimeConfigClientIdentity;
  readonly content: JsonObject;
}

export class RuntimeConfigQueryService {
  constructor(private readonly unitOfWork: PmsUnitOfWork) {}

  async latest(
    request: RuntimeConfigClientRequest,
    identity: RuntimeConfigClientIdentity,
  ): Promise<RuntimeConfigLatest> {
    assertAuthorizedIdentity(request, identity);
    const published = await this.unitOfWork.transaction(async ({ configuration }) => {
      const instance = await configuration.getPublishedRevision(
        target(request, "runtime_instance"),
      );
      const revision =
        instance ??
        (await configuration.getPublishedRevision(target(request, "runtime_deployment")));
      if (revision === null) return null;
      const definition = await configuration.getDefinition(revision.target);
      return definition === null ? null : { revision, definition };
    });
    if (published === null) {
      throw new ConfigurationCenterError(
        "RUNTIME_CONFIG_NOT_FOUND",
        "No published Runtime configuration exists for this target",
      );
    }
    const { revision, definition } = published;
    if (
      revision.target.targetType !== "runtime_deployment" &&
      revision.target.targetType !== "runtime_instance"
    ) {
      throw new ConfigurationCenterError(
        "RUNTIME_CONFIG_PROJECTION_INVALID",
        "Published Runtime configuration has an invalid target projection",
      );
    }
    const secretSafeContent = projectSecretRefs(revision.content, definition.secretPaths);
    return {
      revisionId: revision.revisionId,
      revision: revision.revision,
      checksum: revision.checksum,
      applyMode: revision.applyMode,
      sourceTargetType: revision.target.targetType,
      identity: structuredClone(identity),
      content: projectRuntimeIdentity(secretSafeContent, request.configGroup, identity),
    };
  }
}

function projectSecretRefs(source: JsonObject, secretPaths: readonly string[]): JsonObject {
  const projected = structuredClone(source);
  for (const path of secretPaths) {
    const value = valueAt(projected, path);
    if (value === undefined) continue;
    if (
      !record(value) ||
      Object.keys(value).length !== 1 ||
      typeof value.secretRef !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/.test(value.secretRef)
    ) {
      throw new ConfigurationCenterError(
        "RUNTIME_CONFIG_PROJECTION_INVALID",
        "Published Runtime configuration contains an invalid SecretRef projection",
      );
    }
  }
  return projected;
}

function valueAt(root: JsonObject, pointer: string): JsonObject[string] | undefined {
  let current: unknown = root;
  for (const segment of pointer
    .slice(1)
    .split("/")
    .map((item) => item.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if (!record(current)) return undefined;
    current = current[segment];
  }
  return current as JsonObject[string] | undefined;
}

function record(value: unknown): value is Record<string, JsonObject[string]> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function target(
  request: RuntimeConfigClientRequest,
  targetType: "runtime_deployment" | "runtime_instance",
): ConfigurationTarget {
  return {
    environment: environmentId(request.environment),
    targetType,
    targetId: targetType === "runtime_instance" ? request.instanceId : request.deploymentId,
    configGroup: request.configGroup,
    dataId: request.dataId,
  };
}

function assertAuthorizedIdentity(
  request: RuntimeConfigClientRequest,
  identity: RuntimeConfigClientIdentity,
): void {
  if (
    request.environment !== identity.environment ||
    request.deploymentId !== identity.deploymentId ||
    request.instanceId !== identity.instanceId
  ) {
    throw new ConfigurationCenterError(
      "RUNTIME_CONFIG_IDENTITY_MISMATCH",
      "The Runtime Config client is not authorized for the requested target",
    );
  }
  for (const value of [
    identity.environment,
    identity.deploymentId,
    identity.instanceId,
    identity.providerId,
  ]) {
    if (value.trim().length === 0) {
      throw new ConfigurationCenterError(
        "RUNTIME_CONFIG_UNAUTHORIZED",
        "Runtime Config client identity is invalid",
      );
    }
  }
}

function projectRuntimeIdentity(
  source: JsonObject,
  configGroup: string,
  identity: RuntimeConfigClientIdentity,
): JsonObject {
  const identityFields = new Set([
    "PROVIDER_ID",
    "PMS_DEPLOYMENT_ID",
    "DEPLOYMENT_ID",
    "PMS_INSTANCE_ID",
    "INSTANCE_ID",
    "OTEL_SERVICE_INSTANCE_ID",
  ]);
  const content = Object.fromEntries(
    Object.entries(structuredClone(source)).filter(([field]) => !identityFields.has(field)),
  );
  if (
    configGroup === "runtime.bootstrap" ||
    configGroup.startsWith("provider.") ||
    Object.hasOwn(source, "PROVIDER_ID")
  ) {
    content.PROVIDER_ID = identity.providerId;
  }
  if (
    configGroup === "runtime.observability" ||
    Object.hasOwn(source, "OTEL_SERVICE_INSTANCE_ID")
  ) {
    content.OTEL_SERVICE_INSTANCE_ID = identity.instanceId;
  }
  return content;
}
