import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteHandlerMethod,
} from "fastify";
import type {
  ProviderManagementService,
  ProviderPackageQueryService,
  RuntimeProcessQueryService,
} from "../../../../packages/pms-application/src/index.js";
import type {
  ConfigurationCenter,
  ConfigurationPublicationService,
} from "../../../../packages/configuration-center/src/index.js";
import type { AuditRepository } from "../../../../packages/pms-domain/src/index.js";
import type {
  ProviderStatus,
  ProviderTypeStatus,
  ResourceStatus,
} from "../../../../packages/pms-domain/src/index.js";
import type {
  RegistrySnapshotRepository,
} from "../../../../packages/registry-snapshot/src/index.js";
import type { PmsApiOptions } from "../app.js";
import {
  type RuntimeDeploymentManagementPort,
} from "../runtime-deployment-routes.js";
import {
  ConsoleApiProblem,
  sendConsoleNotFound,
  sendConsoleProblem,
} from "./problem-details.js";
import {
  consoleAuditContext,
  mapCreateConfigurationDraft,
  mapCreateProvider,
  mapCreateResource,
  mapCreateRuntimeDeployment,
  mapProviderStatus,
  mapPublishConfiguration,
  mapResourceStatus,
  mapRollbackConfiguration,
  mapRuntimeDeploymentCommand,
  mapUpdateConfigurationDraft,
  requestInteger,
  requestRecord,
  requestString,
} from "./request-mappers.js";
import {
  mapArrayPage,
  mapAuditEvent,
  mapConfigurationDraft,
  mapConfigurationPublication,
  mapEffectiveConfiguration,
  mapPage,
  mapProvider,
  mapProviderPackage,
  mapProviderResourceBinding,
  mapProviderType,
  mapRegistryDiff,
  mapRegistrySnapshot,
  mapResource,
  mapRuntimeDeployment,
  mapRuntimeDeploymentIntent,
  mapRuntimeProcess,
} from "./response-mappers.js";
import {
  assertCompleteHandlerInventory,
  CONSOLE_ROUTE_INVENTORY,
  fastifyConsolePath,
  PMS_CONSOLE_API_BASE_PATH,
} from "./route-inventory.js";
import {
  frozenConsoleOperation,
  registerFrozenConsoleSchemas,
} from "./validation/contract-loader.js";
import { consoleRouteSchema } from "./validation/response-validator.js";

export interface ConsoleApiDependencies {
  readonly providerPackages: ProviderPackageQueryService;
  readonly management: ProviderManagementService;
  readonly configurationCenter: ConfigurationCenter;
  readonly configurationPublication: ConfigurationPublicationService;
  readonly runtimeDeployments: RuntimeDeploymentManagementPort;
  readonly runtimeProcesses: RuntimeProcessQueryService;
  readonly registrySnapshots: RegistrySnapshotRepository;
  readonly audit: Pick<AuditRepository, "list">;
}

export function consoleApiDependencies(options: PmsApiOptions): ConsoleApiDependencies | undefined {
  const {
    providerPackages,
    management,
    configurationCenter,
    configurationPublication,
    runtimeDeployments,
    runtimeProcesses,
    registrySnapshots,
    audit,
  } = options;
  if (
    providerPackages === undefined ||
    management === undefined ||
    configurationCenter === undefined ||
    configurationPublication === undefined ||
    runtimeDeployments === undefined ||
    runtimeProcesses === undefined ||
    registrySnapshots === undefined ||
    audit === undefined
  ) {
    return undefined;
  }
  return {
    providerPackages,
    management,
    configurationCenter,
    configurationPublication,
    runtimeDeployments,
    runtimeProcesses,
    registrySnapshots,
    audit,
  };
}

export function registerConsoleApiRoutes(
  app: FastifyInstance,
  dependencies: ConsoleApiDependencies,
): void {
  app.register(
    (consoleApp, _options, done) => {
      registerFrozenConsoleSchemas(consoleApp);
      consoleApp.setErrorHandler(sendConsoleProblem);
      consoleApp.setNotFoundHandler(sendConsoleNotFound);
      const handlers = createConsoleHandlers(dependencies);
      assertCompleteHandlerInventory(Object.keys(handlers));
      assertFrozenRouteInventory();
      for (const route of CONSOLE_ROUTE_INVENTORY) {
        const handler = handlers[route.operationId];
        if (handler === undefined) {
          throw new Error(`PMS_CONSOLE_HANDLER_NOT_FOUND:${route.operationId}`);
        }
        consoleApp.route({
          method: route.method,
          url: fastifyConsolePath(route.path),
          schema: consoleRouteSchema(route.operationId),
          config: { operationId: route.operationId },
          handler,
        });
      }
      done();
    },
    { prefix: PMS_CONSOLE_API_BASE_PATH },
  );
}

function createConsoleHandlers(
  dependencies: ConsoleApiDependencies,
): Readonly<Record<string, RouteHandlerMethod>> {
  const {
    providerPackages,
    management,
    configurationCenter,
    configurationPublication,
    runtimeDeployments,
    runtimeProcesses,
    registrySnapshots,
    audit,
  } = dependencies;

  return {
    listProviderPackages: (request) => {
      const query = requestRecord(request.query);
      return mapArrayPage(
        providerPackages.list({
          ...optionalString(query, "providerType"),
          ...optionalString(query, "hostingMode"),
          ...optionalString(query, "componentStatus"),
          ...optionalString(query, "realResourceStatus"),
        } as Parameters<ProviderPackageQueryService["list"]>[0]),
        mapProviderPackage,
      );
    },
    getProviderPackage: (request) => {
      const params = requestRecord(request.params);
      const query = requestRecord(request.query);
      return mapProviderPackage(
        providerPackages.get(
          requestString(params, "packageId"),
          optionalValue(query, "version") as string | undefined,
        ),
      );
    },
    listProviderTypes: async (request) => {
      const query = requestRecord(request.query);
      return mapPage(
        await management.listProviderTypes(
          page(query),
          optionalValue(query, "status") as ProviderTypeStatus | undefined,
        ),
        mapProviderType,
      );
    },
    getProviderType: async (request) =>
      mapProviderType(
        await management.getProviderType(
          requestString(requestRecord(request.params), "providerTypeId"),
        ),
      ),
    listProviders: async (request) => {
      const query = requestRecord(request.query);
      return mapPage(
        await management.listProviders(
          page(query),
          optionalValue(query, "status") as ProviderStatus | undefined,
        ),
        mapProvider,
      );
    },
    createProvider: async (request, reply) => {
      const result = await management.createProvider(
        mapCreateProvider(request.body),
        consoleAuditContext(request),
      );
      void reply.status(201);
      return mapProvider(result);
    },
    getProvider: async (request) =>
      mapProvider(
        await management.getProvider(requestString(requestRecord(request.params), "providerId")),
      ),
    updateProviderStatus: async (request) => {
      const input = mapProviderStatus(request.body);
      return mapProvider(
        await management.updateProviderStatus(
          requestString(requestRecord(request.params), "providerId"),
          input.status,
          input.expectedUpdatedAt,
          consoleAuditContext(request),
        ),
      );
    },
    listResources: async (request) => {
      const query = requestRecord(request.query);
      return mapPage(
        await management.listResources(
          requestString(query, "environment"),
          page(query),
          optionalValue(query, "status") as ResourceStatus | undefined,
        ),
        mapResource,
      );
    },
    createResource: async (request, reply) => {
      const result = await management.createResource(
        mapCreateResource(request.body),
        consoleAuditContext(request),
      );
      void reply.status(201);
      return mapResource(result);
    },
    getResource: async (request) => {
      const params = requestRecord(request.params);
      return mapResource(
        await management.getResource({
          environment: requestString(params, "environment"),
          resourceId: requestString(params, "resourceId"),
        }),
      );
    },
    updateResourceStatus: async (request) => {
      const params = requestRecord(request.params);
      const input = mapResourceStatus(request.body);
      return mapResource(
        await management.updateResourceStatus(
          {
            environment: requestString(params, "environment"),
            resourceId: requestString(params, "resourceId"),
          },
          input.status,
          input.expectedUpdatedAt,
          consoleAuditContext(request),
        ),
      );
    },
    listProviderResourceBindings: async (request) =>
      mapArrayPage(
        await management.listProviderResources(
          requestString(requestRecord(request.params), "providerId"),
        ),
        mapProviderResourceBinding,
      ),
    bindProviderResource: async (request, reply) => {
      const body = requestRecord(request.body);
      const result = await management.bindResource(
        {
          providerId: requestString(requestRecord(request.params), "providerId"),
          environment: requestString(body, "environment"),
          resourceId: requestString(body, "resourceId"),
        },
        consoleAuditContext(request),
      );
      void reply.status(201);
      return mapProviderResourceBinding(result);
    },
    unbindProviderResource: async (request, reply) => {
      const params = requestRecord(request.params);
      await management.unbindResource(
        {
          providerId: requestString(params, "providerId"),
          environment: requestString(params, "environment"),
          resourceId: requestString(params, "resourceId"),
        },
        consoleAuditContext(request),
      );
      return reply.status(204).send();
    },
    createConfigurationDraft: (request, reply) => {
      consoleAuditContext(request);
      const result = configurationCenter.createDraft(mapCreateConfigurationDraft(request.body));
      void reply.status(201);
      return mapConfigurationDraft(result);
    },
    getConfigurationDraft: (request) =>
      mapConfigurationDraft(
        configurationCenter.getDraft(requestString(requestRecord(request.params), "draftId")),
      ),
    updateConfigurationDraft: (request) => {
      consoleAuditContext(request);
      return mapConfigurationDraft(
        configurationCenter.updateDraft(
          requestString(requestRecord(request.params), "draftId"),
          mapUpdateConfigurationDraft(request.body),
        ),
      );
    },
    validateConfigurationDraft: (request) => {
      consoleAuditContext(request);
      return mapConfigurationDraft(
        configurationCenter.validateDraft(
          requestString(requestRecord(request.params), "draftId"),
        ),
      );
    },
    previewEffectiveConfiguration: (request) =>
      mapEffectiveConfiguration(
        configurationCenter.effectivePreview(
          requestString(requestRecord(request.params), "draftId"),
        ),
      ),
    publishConfigurationDraft: async (request) =>
      mapConfigurationPublication(
        await configurationPublication.publish(
          mapPublishConfiguration(
            requestString(requestRecord(request.params), "draftId"),
            request.body,
          ),
          consoleAuditContext(request),
        ),
      ),
    rollbackConfigurationDraft: async (request) =>
      mapConfigurationPublication(
        await configurationPublication.rollback(
          mapRollbackConfiguration(
            requestString(requestRecord(request.params), "draftId"),
            request.body,
          ),
          consoleAuditContext(request),
        ),
      ),
    listRuntimeDeployments: async (request) => {
      const query = requestRecord(request.query);
      const result = await runtimeDeployments.list({
        providerId: requestString(query, "providerId"),
        limit: optionalInteger(query, "limit") ?? 100,
        ...optionalString(query, "environment"),
        ...optionalString(query, "status"),
        ...optionalString(query, "cursor"),
      } as Parameters<RuntimeDeploymentManagementPort["list"]>[0]);
      return mapArrayPage(result.items, mapRuntimeDeployment, result.nextCursor);
    },
    createRuntimeDeployment: async (request, reply) => {
      const context = consoleAuditContext(request);
      const result = await runtimeDeployments.create(
        mapCreateRuntimeDeployment(request.body),
        context,
      );
      void reply.status(202);
      return mapRuntimeDeploymentIntent(result, context.correlationId);
    },
    getRuntimeDeployment: async (request) => {
      const result = await runtimeDeployments.get(
        requestString(requestRecord(request.query), "providerId"),
        requestString(requestRecord(request.params), "deploymentId"),
      );
      if (result === null) {
        throw new ConsoleApiProblem(
          404,
          "RUNTIME_DEPLOYMENT_NOT_FOUND",
          "The RuntimeDeployment does not exist in Provider scope",
        );
      }
      return mapRuntimeDeployment(result);
    },
    ...runtimeActionHandlers(runtimeDeployments),
    listRuntimeProcesses: async (request) => {
      const query = requestRecord(request.query);
      const result = await runtimeProcesses.list({
        providerId: requestString(query, "providerId"),
        deploymentId: requestString(query, "deploymentId"),
        limit: optionalInteger(query, "limit") ?? 100,
        ...optionalString(query, "processState"),
        ...optionalString(query, "observedHealth"),
        ...optionalString(query, "cursor"),
      } as Parameters<RuntimeProcessQueryService["list"]>[0]);
      return mapArrayPage(result.items, mapRuntimeProcess, result.nextCursor);
    },
    getRuntimeProcess: async (request) =>
      mapRuntimeProcess(
        await runtimeProcesses.get(
          requestString(requestRecord(request.query), "providerId"),
          requestString(requestRecord(request.params), "instanceId"),
        ),
      ),
    getLatestRegistrySnapshot: async (request, reply) => {
      const latest = await registrySnapshots.latest(
        requestString(requestRecord(request.params), "environment"),
      );
      if (latest === null) {
        throw new ConsoleApiProblem(
          404,
          "REGISTRY_SNAPSHOT_NOT_FOUND",
          "The Registry snapshot does not exist",
        );
      }
      const etag = `"${latest.checksum}"`;
      void reply.header("etag", etag).header("cache-control", "private, no-cache");
      if (etagMatches(request.headers["if-none-match"], latest.checksum)) {
        return reply.status(304).send();
      }
      return mapRegistrySnapshot(latest);
    },
    listRegistryHistory: async (request) => {
      const query = requestRecord(request.query);
      const items = await registrySnapshots.history(
        requestString(requestRecord(request.params), "environment"),
        optionalInteger(query, "limit"),
      );
      return mapArrayPage(items, mapRegistrySnapshot);
    },
    diffRegistrySnapshots: async (request) => {
      const query = requestRecord(request.query);
      return mapRegistryDiff(
        await registrySnapshots.diff(
          requestString(requestRecord(request.params), "environment"),
          requestInteger(query, "fromRevision"),
          requestInteger(query, "toRevision"),
        ),
      );
    },
    listAuditEvents: async (request) => {
      const query = requestRecord(request.query);
      const result = await audit.list({
        limit: optionalInteger(query, "limit") ?? 100,
        ...optionalString(query, "cursor"),
        ...optionalString(query, "subjectType"),
        ...optionalString(query, "subjectId"),
        ...optionalString(query, "correlationId"),
        ...(query.occurredBefore === undefined
          ? {}
          : { occurredBefore: new Date(requestString(query, "occurredBefore")) }),
      });
      return mapPage(result, mapAuditEvent);
    },
  };
}

function runtimeActionHandlers(
  runtimeDeployments: RuntimeDeploymentManagementPort,
): Readonly<Record<string, RouteHandlerMethod>> {
  const definitions = {
    startRuntimeDeployment: "start",
    stopRuntimeDeployment: "stop",
    restartRuntimeDeployment: "restart",
    scaleRuntimeDeployment: "scale",
    reconcileRuntimeDeployment: "reconcile",
  } as const;
  return Object.fromEntries(
    Object.entries(definitions).map(([operationId, command]) => [
      operationId,
      async (request: FastifyRequest, reply: FastifyReply) => {
        const context = consoleAuditContext(request);
        const result = await runtimeDeployments.command(
          mapRuntimeDeploymentCommand(
            requestString(requestRecord(request.params), "deploymentId"),
            command,
            request.body,
          ),
          context,
        );
        void reply.status(202);
        return mapRuntimeDeploymentIntent(result, context.correlationId);
      },
    ]),
  );
}

function assertFrozenRouteInventory(): void {
  for (const route of CONSOLE_ROUTE_INVENTORY) {
    const frozen = frozenConsoleOperation(route.operationId);
    if (frozen.method !== route.method || frozen.path !== route.path) {
      throw new Error(`PMS_CONSOLE_ROUTE_INVENTORY_DRIFT:${route.operationId}`);
    }
  }
}

function page(query: Readonly<Record<string, unknown>>): {
  readonly limit: number;
  readonly cursor?: string;
} {
  return {
    limit: optionalInteger(query, "limit") ?? 100,
    ...optionalString(query, "cursor"),
  };
}

function optionalString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, string>> {
  return value[key] === undefined ? {} : { [key]: requestString(value, key) };
}

function optionalInteger(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  return value[key] === undefined ? undefined : requestInteger(value, key);
}

function optionalValue(
  value: Readonly<Record<string, unknown>>,
  key: string,
): unknown | undefined {
  return value[key];
}

function etagMatches(value: string | readonly string[] | undefined, checksum: string): boolean {
  if (typeof value !== "string") return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "");
    return normalized === "*" || normalized === `"${checksum}"` || normalized === checksum;
  });
}
