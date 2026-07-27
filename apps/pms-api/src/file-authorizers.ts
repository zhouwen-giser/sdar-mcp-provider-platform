import {
  ConfigurationCenterError,
  type RuntimeConfigClientAuthorizer,
  type RuntimeConfigClientCredentials,
  type RuntimeConfigClientIdentity,
  type RuntimeConfigClientRequest,
} from "../../../packages/configuration-center/src/index.js";
import {
  type RuntimeRegistrationAuthorizer,
  type RuntimeRegistrationCredentials,
  RuntimeRegistrationAuthorizationError,
  type RuntimeRegistrationScope,
} from "../../../packages/runtime-registration/src/authorization.js";
import {
  type PmsApiPrincipal,
  type PmsApiRoleAuthorizer,
  PmsApiAuthorizationError,
} from "./authorization.js";
import * as config from "./config.js";
import type {
  FileBackedManagementPrincipal,
  FileBackedRuntimeConfigPrincipal,
  FileBackedRuntimeRegistrationPrincipal,
  PmsManagementCredentials,
  PmsRuntimeCredentials,
} from "./config.js";
import type { RuntimeConfigScope } from "./config.js";

export interface FilePmsApiRoleAuthorizerContract extends PmsApiRoleAuthorizer {
  providers: {
    readonly management: PmsManagementCredentials;
  };
}

export class FilePmsApiRoleAuthorizer implements FilePmsApiRoleAuthorizerContract {
  readonly #principals: readonly FileBackedManagementPrincipal[];
  providers: { readonly management: PmsManagementCredentials };

  constructor(credentials: PmsManagementCredentials) {
    this.#principals = mergeManagementPrincipals(credentials);
    this.providers = { management: credentials };
  }

  authenticate(credentials: { readonly authorization?: string }): Promise<PmsApiPrincipal> {
    const token = parseBearer(credentials.authorization);
    if (token === undefined) {
      return Promise.reject(new PmsApiAuthorizationError("MANAGEMENT_AUTHENTICATION_REQUIRED"));
    }
    const tokenDigest = config.hashSecretToken(token);
    const principal = this.#principals.find((entry) =>
      config.hashEquals(tokenDigest, entry.tokenDigest),
    );
    if (principal === undefined) {
      return Promise.reject(new PmsApiAuthorizationError("MANAGEMENT_AUTHENTICATION_REQUIRED"));
    }
    return Promise.resolve({
      subjectId: principal.subjectId,
      roles: [...principal.roles],
    });
  }
}

export interface RuntimeConfigRequestWithProfile extends RuntimeConfigClientRequest {
  readonly providerId: string;
  readonly runtimeVersion: string;
  readonly protocolVersion: string;
}

export interface FileRuntimeConfigClientAuthorizerContract extends RuntimeConfigClientAuthorizer {
  authorizeForScope(
    credentials: RuntimeConfigClientCredentials,
    target: RuntimeConfigRequestWithProfile,
    requiredScope: RuntimeConfigScope,
  ): Promise<RuntimeConfigClientIdentity>;
}

export class FileRuntimeConfigClientAuthorizer implements FileRuntimeConfigClientAuthorizer {
  readonly #principals: readonly FileBackedRuntimeConfigPrincipal[];

  constructor(credentials: PmsRuntimeCredentials | readonly FileBackedRuntimeConfigPrincipal[]) {
    this.#principals = "config" in credentials ? credentials.config : credentials;
  }

  async authorize(
    credentials: RuntimeConfigClientCredentials,
    target: RuntimeConfigClientRequest,
  ): Promise<RuntimeConfigClientIdentity> {
    const principal = await this.authenticate(credentials);
    if (!runtimeScopeAllows(principal.scopes, "runtime:config:read", config.runtimeConfigScopes)) {
      throw new ConfigurationCenterError(
        "RUNTIME_CONFIG_UNAUTHORIZED",
        "Runtime Config token does not include required scope runtime:config:read",
      );
    }
    if (
      principal.environment !== target.environment ||
      principal.deploymentId !== target.deploymentId ||
      principal.instanceId !== target.instanceId
    ) {
      throw new ConfigurationCenterError(
        "RUNTIME_CONFIG_IDENTITY_MISMATCH",
        "Runtime Config token is not authorized for this target",
      );
    }
    return {
      environment: target.environment,
      deploymentId: target.deploymentId,
      instanceId: target.instanceId,
      providerId: principal.providerId,
    };
  }

  async authorizeForScope(
    credentials: RuntimeConfigClientCredentials,
    target: RuntimeConfigRequestWithProfile,
    requiredScope: RuntimeConfigScope,
  ): Promise<RuntimeConfigClientIdentity> {
    const principal = await this.authenticate(credentials);
    if (!runtimeScopeAllows(principal.scopes, requiredScope, config.runtimeConfigScopes)) {
      throw new ConfigurationCenterError(
        "RUNTIME_CONFIG_UNAUTHORIZED",
        `Runtime Config token does not include required scope ${requiredScope}`,
      );
    }
    assertRuntimeConfigIdentity(principal, target);
    return {
      environment: target.environment,
      deploymentId: target.deploymentId,
      instanceId: target.instanceId,
      providerId: principal.providerId,
    };
  }

  private authenticate(
    credentials: RuntimeConfigClientCredentials,
  ): Promise<FileBackedRuntimeConfigPrincipal> {
    const token = parseBearer(credentials.authorization);
    if (token === undefined) {
      return Promise.reject(
        new ConfigurationCenterError(
          "RUNTIME_CONFIG_UNAUTHORIZED",
          "Runtime Config authentication is required",
        ),
      );
    }
    const tokenDigest = config.hashSecretToken(token);
    const principal = this.#principals.find((entry) =>
      config.hashEquals(tokenDigest, entry.tokenDigest),
    );
    if (principal === undefined) {
      return Promise.reject(
        new ConfigurationCenterError(
          "RUNTIME_CONFIG_UNAUTHORIZED",
          "Runtime Config token is not authorized",
        ),
      );
    }
    return Promise.resolve(principal);
  }
}

export interface RuntimeRegistrationTargetIdentity {
  readonly providerId?: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly runtimeVersion?: string;
  readonly protocolVersion?: string;
}

export interface FileRuntimeRegistrationAuthorizerContract extends RuntimeRegistrationAuthorizer {
  authorizeForScope(
    credentials: RuntimeRegistrationCredentials,
    target: RuntimeRegistrationTargetIdentity,
    requiredScope: RuntimeRegistrationScope,
  ): Promise<FileBackedRuntimeRegistrationPrincipal>;
}

export class FileRuntimeRegistrationAuthorizer implements FileRuntimeRegistrationAuthorizer {
  readonly #principals: readonly FileBackedRuntimeRegistrationPrincipal[];

  constructor(
    credentials: PmsRuntimeCredentials | readonly FileBackedRuntimeRegistrationPrincipal[],
  ) {
    this.#principals = "registration" in credentials ? credentials.registration : credentials;
  }

  async authorize(
    credentials: RuntimeRegistrationCredentials,
    target: Pick<RuntimeRegistrationTargetIdentity, "deploymentId" | "instanceId">,
    requiredScope: RuntimeRegistrationScope,
  ): Promise<FileBackedRuntimeRegistrationPrincipal> {
    return this.authorizeForScope(
      credentials,
      { deploymentId: target.deploymentId, instanceId: target.instanceId },
      requiredScope,
    );
  }

  async authorizeForScope(
    credentials: RuntimeRegistrationCredentials,
    target: RuntimeRegistrationTargetIdentity,
    requiredScope: RuntimeRegistrationScope,
  ): Promise<FileBackedRuntimeRegistrationPrincipal> {
    const principal = await this.authenticate(credentials);
    if (!runtimeScopeAllows(principal.scopes, requiredScope, config.runtimeRegistrationScopes)) {
      throw new RuntimeRegistrationAuthorizationError("RUNTIME_REGISTRATION_FORBIDDEN");
    }
    if (principal.providerId !== target.providerId && target.providerId !== undefined) {
      throw new RuntimeRegistrationAuthorizationError("RUNTIME_REGISTRATION_FORBIDDEN");
    }
    if (
      principal.deploymentId !== target.deploymentId ||
      principal.instanceId !== target.instanceId
    ) {
      throw new RuntimeRegistrationAuthorizationError("RUNTIME_REGISTRATION_FORBIDDEN");
    }
    if (target.runtimeVersion !== undefined && principal.runtimeVersion !== target.runtimeVersion) {
      throw new RuntimeRegistrationAuthorizationError("RUNTIME_REGISTRATION_FORBIDDEN");
    }
    if (
      target.protocolVersion !== undefined &&
      principal.protocolVersion !== target.protocolVersion
    ) {
      throw new RuntimeRegistrationAuthorizationError("RUNTIME_REGISTRATION_FORBIDDEN");
    }
    return principal;
  }

  private authenticate(
    credentials: RuntimeRegistrationCredentials,
  ): Promise<FileBackedRuntimeRegistrationPrincipal> {
    const token = parseBearer(credentials.authorization);
    if (token === undefined) {
      return Promise.reject(
        new RuntimeRegistrationAuthorizationError("RUNTIME_REGISTRATION_UNAUTHORIZED"),
      );
    }
    const tokenDigest = config.hashSecretToken(token);
    const principal = this.#principals.find((entry) =>
      config.hashEquals(tokenDigest, entry.tokenDigest),
    );
    if (principal === undefined) {
      return Promise.reject(
        new RuntimeRegistrationAuthorizationError("RUNTIME_REGISTRATION_UNAUTHORIZED"),
      );
    }
    return Promise.resolve(principal);
  }
}

function parseBearer(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const token = raw.trim();
  if (token.length === 0) return undefined;
  if (!/^bearer\s+/i.test(token)) {
    return token.includes(" ") ? undefined : token;
  }
  const value = token.substring(token.indexOf(" ") + 1).trim();
  return value.length === 0 ? undefined : value;
}

function runtimeScopeAllows(
  scopes: readonly string[],
  requiredScope: string,
  allowed: readonly string[],
): boolean {
  if (!allowed.includes(requiredScope)) {
    return false;
  }
  return scopes.includes(requiredScope);
}

function assertRuntimeConfigIdentity(
  principal: FileBackedRuntimeConfigPrincipal,
  target: RuntimeConfigRequestWithProfile,
): void {
  if (
    principal.providerId !== target.providerId ||
    principal.environment !== target.environment ||
    principal.deploymentId !== target.deploymentId ||
    principal.instanceId !== target.instanceId ||
    principal.runtimeVersion !== target.runtimeVersion ||
    principal.protocolVersion !== target.protocolVersion
  ) {
    throw new ConfigurationCenterError(
      "RUNTIME_CONFIG_IDENTITY_MISMATCH",
      "Runtime Config token is not authorized",
    );
  }
}

function mergeManagementPrincipals(
  config: PmsManagementCredentials,
): readonly FileBackedManagementPrincipal[] {
  const merged = new Map<string, FileBackedManagementPrincipal>();
  for (const principal of [...config.readers, ...config.administrators]) {
    const existing = merged.get(principal.tokenDigest);
    if (existing === undefined) {
      merged.set(principal.tokenDigest, {
        ...principal,
      });
      continue;
    }
    if (existing.subjectId !== principal.subjectId) {
      continue;
    }
    merged.set(principal.tokenDigest, {
      ...existing,
      roles: [...new Set([...existing.roles, ...principal.roles])],
    });
  }
  return [...merged.values()];
}
