import Fastify, { type FastifyInstance } from "fastify";
import type {
  ProviderManagementService,
  ProviderPackageListFilter,
  ProviderPackageQueryService,
  RuntimeProcessQueryService,
} from "../../../packages/pms-application/src/index.js";
import type {
  ConfigurationCenter,
  ConfigurationPublicationService,
  RuntimeConfigAcknowledgementService,
  RuntimeConfigClientAuthorizer,
  RuntimeConfigQueryService,
} from "../../../packages/configuration-center/src/index.js";
import { registerConfigurationRoutes } from "./configuration-routes.js";
import { attachRequestContext, requestContext } from "./context.js";
import { notFoundError, sendPmsError } from "./errors.js";
import { pmsOpenApiDocument } from "./openapi.js";
import { registerManagementRoutes } from "./management-routes.js";
import {
  registerRuntimeConfigRoutes,
  type RuntimeConfigWatchPort,
} from "./runtime-config-routes.js";
import {
  registerRuntimeDeploymentRoutes,
  type RuntimeDeploymentManagementPort,
} from "./runtime-deployment-routes.js";
import { registerRuntimeProcessRoutes } from "./runtime-process-routes.js";
import { registerRuntimeRegistrationRoutes } from "./runtime-registration-routes.js";
import {
  auditAuthenticationRejection,
  authorizeManagementRequest,
  type AuthenticationRejectionAuditPort,
  type PmsApiRoleAuthorizer,
} from "./authorization.js";
import type {
  RuntimeRegistrationAuthorizer,
  RuntimeRegistrationService,
} from "../../../packages/runtime-registration/src/index.js";
import type { AuditRepository } from "../../../packages/pms-domain/src/index.js";
import type { RegistrySnapshotRepository } from "../../../packages/registry-snapshot/src/index.js";
import { registerAuditRoutes } from "./audit-routes.js";
import { registerRegistryRoutes } from "./registry-routes.js";
import { registerSdarRegistryProjectionRoutes } from "./sdar-registry-projection-routes.js";
import {
  consoleApiDependencies,
  registerConsoleApiRoutes,
} from "./console/register-console-routes.js";

export interface PmsReadiness {
  readonly ready: boolean;
  readonly checks?: Readonly<Record<string, "ready" | "unavailable">>;
}

export interface PmsApiOptions {
  readonly readiness?: () => Promise<PmsReadiness>;
  readonly providerPackages?: ProviderPackageQueryService;
  readonly management?: ProviderManagementService;
  readonly runtimeDeployments?: RuntimeDeploymentManagementPort;
  readonly runtimeProcesses?: RuntimeProcessQueryService;
  readonly runtimeRegistration?: RuntimeRegistrationService;
  readonly runtimeRegistrationAuthorizer?: RuntimeRegistrationAuthorizer;
  readonly configurationCenter?: ConfigurationCenter;
  readonly configurationPublication?: ConfigurationPublicationService;
  readonly runtimeConfigQuery?: RuntimeConfigQueryService;
  readonly runtimeConfigAuthorizer?: RuntimeConfigClientAuthorizer;
  readonly runtimeConfigWatch?: RuntimeConfigWatchPort;
  readonly runtimeConfigAcknowledgements?: RuntimeConfigAcknowledgementService;
  readonly registrySnapshots?: RegistrySnapshotRepository;
  readonly audit?: Pick<AuditRepository, "list">;
  readonly registryWatchPollIntervalMs?: number;
  readonly sdarRegistryProjectionTtlSeconds?: number;
  readonly managementAuthorizer?: PmsApiRoleAuthorizer;
  readonly authenticationRejectionAudit?: AuthenticationRejectionAuditPort;
}

export function createPmsApi(options: PmsApiOptions = {}): FastifyInstance {
  const readiness: () => Promise<PmsReadiness> =
    options.readiness ?? (() => Promise.resolve({ ready: true }));
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });

  app.addHook("onRequest", (request, reply, done) => {
    attachRequestContext(request, reply);
    done();
  });
  const managementAuthorizer = options.managementAuthorizer;
  if (managementAuthorizer !== undefined) {
    app.addHook("preHandler", async (request) => {
      try {
        await authorizeManagementRequest(request, managementAuthorizer);
      } catch (error) {
        await auditAuthenticationRejection(options.authenticationRejectionAudit, request, error);
        throw error;
      }
    });
  }
  app.setErrorHandler(sendPmsError);
  app.setNotFoundHandler(notFoundError);

  app.get("/health/live", () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    const state = await readiness();
    if (!state.ready) void reply.status(503);
    return { status: state.ready ? "ready" : "unavailable", checks: state.checks ?? {} };
  });
  app.get("/api/v1", (request) => ({
    apiVersion: "v1",
    request: requestContext(request),
    links: { openapi: "/api/v1/openapi.json" },
  }));
  app.get("/api/v1/openapi.json", () => pmsOpenApiDocument());
  if (options.providerPackages !== undefined) {
    registerProviderPackageRoutes(app, options.providerPackages);
  }
  if (options.management !== undefined) {
    registerManagementRoutes(app, options.management);
  }
  if (options.runtimeDeployments !== undefined) {
    registerRuntimeDeploymentRoutes(app, options.runtimeDeployments);
  }
  if (options.runtimeProcesses !== undefined) {
    registerRuntimeProcessRoutes(app, options.runtimeProcesses);
  }
  if (
    options.runtimeRegistration !== undefined &&
    options.runtimeRegistrationAuthorizer !== undefined
  ) {
    registerRuntimeRegistrationRoutes(
      app,
      options.runtimeRegistration,
      options.runtimeRegistrationAuthorizer,
      options.authenticationRejectionAudit,
    );
  }
  if (options.configurationCenter !== undefined) {
    registerConfigurationRoutes(app, options.configurationCenter, options.configurationPublication);
  }
  if (options.runtimeConfigQuery !== undefined && options.runtimeConfigAuthorizer !== undefined) {
    registerRuntimeConfigRoutes(
      app,
      options.runtimeConfigQuery,
      options.runtimeConfigAuthorizer,
      options.runtimeConfigWatch,
      options.runtimeConfigAcknowledgements,
      options.authenticationRejectionAudit,
    );
  }
  if (options.registrySnapshots !== undefined) {
    registerRegistryRoutes(app, options.registrySnapshots, {
      ...(options.registryWatchPollIntervalMs === undefined
        ? {}
        : { pollIntervalMs: options.registryWatchPollIntervalMs }),
    });
    registerSdarRegistryProjectionRoutes(app, options.registrySnapshots, {
      ...(options.sdarRegistryProjectionTtlSeconds === undefined
        ? {}
        : { ttlSeconds: options.sdarRegistryProjectionTtlSeconds }),
      ...(options.registryWatchPollIntervalMs === undefined
        ? {}
        : { pollIntervalMs: options.registryWatchPollIntervalMs }),
    });
  }
  if (options.audit !== undefined) registerAuditRoutes(app, options.audit);
  const consoleDependencies = consoleApiDependencies(options);
  if (consoleDependencies !== undefined) {
    registerConsoleApiRoutes(app, consoleDependencies);
  }

  return app;
}

interface PackageListQuery {
  readonly providerType?: string;
  readonly hostingMode?: ProviderPackageListFilter["hostingMode"];
  readonly componentStatus?: ProviderPackageListFilter["componentStatus"];
  readonly realResourceStatus?: ProviderPackageListFilter["realResourceStatus"];
}

interface PackageDetailParameters {
  readonly packageId: string;
}

interface PackageDetailQuery {
  readonly version?: string;
}

function registerProviderPackageRoutes(
  app: FastifyInstance,
  packages: ProviderPackageQueryService,
): void {
  app.get<{ Querystring: PackageListQuery }>(
    "/api/v1/provider-packages",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            providerType: { type: "string", minLength: 1, maxLength: 128 },
            hostingMode: { enum: ["vendor_managed", "platform_managed"] },
            componentStatus: { enum: ["passed", "partial", "pending", "failed"] },
            realResourceStatus: {
              enum: ["qualified", "pending", "failed", "not_applicable"],
            },
          },
          additionalProperties: false,
        },
      },
    },
    (request) => ({ items: packages.list(packageFilter(request.query)) }),
  );
  app.get<{ Params: PackageDetailParameters; Querystring: PackageDetailQuery }>(
    "/api/v1/provider-packages/:packageId",
    {
      schema: {
        params: {
          type: "object",
          required: ["packageId"],
          properties: { packageId: { type: "string", minLength: 1, maxLength: 128 } },
          additionalProperties: false,
        },
        querystring: {
          type: "object",
          properties: { version: { type: "string", minLength: 1, maxLength: 64 } },
          additionalProperties: false,
        },
      },
    },
    (request) => packages.get(request.params.packageId, request.query.version),
  );
}

function packageFilter(query: PackageListQuery): ProviderPackageListFilter {
  return {
    ...(query.providerType === undefined ? {} : { providerType: query.providerType }),
    ...(query.hostingMode === undefined ? {} : { hostingMode: query.hostingMode }),
    ...(query.componentStatus === undefined ? {} : { componentStatus: query.componentStatus }),
    ...(query.realResourceStatus === undefined
      ? {}
      : { realResourceStatus: query.realResourceStatus }),
  };
}
