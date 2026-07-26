import * as grpc from "@grpc/grpc-js";
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { GrpcAdapterGateway } from "../../../packages/adapter-protocol/src/index.js";
import type { ProviderManifest } from "../../../packages/adapter-protocol/src/index.js";
import { RUNTIME_VERSION } from "../../../packages/domain/src/index.js";
import {
  createAuthorizationResolver,
  LegacyMcpProtocolHandler,
  ProtocolRouter,
  Sep2663ProtocolHandler,
  TaskNotificationStream,
  BusinessEventNotificationManager,
  BusinessEventRelationManager,
} from "../../../packages/mcp-protocol/src/index.js";
import type { AuthenticationOptions } from "../../../packages/mcp-protocol/src/index.js";
import {
  BusinessEventMetricPolicy,
  BusinessEventTelemetryBridge,
  createLogger,
  ProviderTelemetry,
  RuntimeMetrics,
} from "../../../packages/observability/src/index.js";
import type { RuntimeLogger } from "../../../packages/observability/src/index.js";
import { OperationRegistry } from "../../../packages/operation-registry/src/index.js";
import type { ValidatedManifest } from "../../../packages/operation-registry/src/index.js";
import {
  ProviderTelemetryGrpcServer,
  ProviderTelemetryIngress,
} from "../../../packages/provider-telemetry/src/index.js";
import {
  OperationSnapshotRepository,
  IdempotencyRepository,
  OutboxRepository,
  ProviderOpsDeliveryRepository,
  BusinessEventRepository,
  BusinessEventProviderOpsRecorder,
  TaskRepository,
  runMigrations,
} from "../../../packages/persistence-postgres/src/index.js";
import {
  DurableCommandDispatcher,
  DurableProviderOpsPublisher,
  DurableScheduler,
  InternalNoopOutboxSink,
  OutboxPublisher,
  RecoveryManager,
  TaskEngine,
  OutboxCleaner,
  TtlCleaner,
  WebhookOutboxSink,
} from "../../../packages/task-engine/src/index.js";
import type { RuntimeConfig } from "./config.js";
import { BoundedRateLimiter } from "./rate-limiter.js";
import { AdapterManifestWatcher } from "./manifest-watcher.js";
import { AdapterBusinessEventSourceClient } from "./business-events/source-client.js";

function createHttpServer(logger: RuntimeLogger, bodyLimit: number) {
  return Fastify({ loggerInstance: logger, bodyLimit });
}

type RuntimeHttpServer = ReturnType<typeof createHttpServer>;

export interface RuntimeDependencies {
  database: "starting" | "ready" | "failed";
  adapter: "starting" | "ready" | "failed";
  adapterManifest: "starting" | "ready" | "failed";
  recovery: "starting" | "ready" | "failed";
  scheduler: "starting" | "ready" | "failed";
  commandDispatcher: "starting" | "ready" | "failed";
  ttlCleaner: "starting" | "ready" | "failed";
  outboxPublisher: "starting" | "ready" | "failed";
  outboxCleaner: "starting" | "ready" | "failed";
  providerTelemetryIngress: "starting" | "ready" | "failed";
  businessEventPersistence: BusinessEventReadinessStatus;
  businessEventReplay: BusinessEventReadinessStatus;
  businessEventIngest: BusinessEventReadinessStatus;
  businessEventFinalizer: BusinessEventReadinessStatus;
  businessEventAdapterSources: Record<string, BusinessEventReadinessStatus>;
  businessEventRetention: BusinessEventReadinessStatus;
  businessEventProjection: BusinessEventReadinessStatus;
}

export type BusinessEventReadinessStatus =
  "disabled" | "starting" | "ready" | "degraded" | "failed";

export interface RuntimeApplication {
  app: RuntimeHttpServer;
  gateway: GrpcAdapterGateway;
  pool: Pool;
  dependencies: RuntimeDependencies;
  initialize(): Promise<ProviderManifest>;
}

export function createRuntime(config: RuntimeConfig): RuntimeApplication {
  const logger = createLogger(config.LOG_LEVEL);
  if (config.leaseValidationMode === "degraded") {
    logger.warn(
      { message: config.leaseValidationMessage },
      "runtime lease configuration validation fell back to degraded mode",
    );
  }
  const app = createHttpServer(logger, config.HTTP_BODY_LIMIT_BYTES);
  const metrics = new RuntimeMetrics();
  const telemetrySelfGauges: Record<string, number> = {};
  const telemetryInstanceId = config.OTEL_SERVICE_INSTANCE_ID ?? randomUUID();
  let telemetry: ProviderTelemetry | undefined;
  let businessEventTelemetry: BusinessEventTelemetryBridge | undefined;
  let businessEventSourceIds: string[] = [];
  let providerTelemetryServer: ProviderTelemetryGrpcServer | undefined;
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: config.DATABASE_POOL_MAX });
  const resolveAuthorization = createAuthorizationResolver(authenticationOptions(config));
  const gateway = new GrpcAdapterGateway({
    endpoint: config.ADAPTER_ENDPOINT,
    providerId: config.PROVIDER_ID,
    credentials: adapterCredentials(config),
    timeoutMs: config.ADAPTER_RPC_TIMEOUT_MS,
    onRpc: (method, outcome, durationMs) => {
      metrics.increment("sdar_adapter_rpc_total", { method, outcome });
      telemetry?.metric("adapter_rpc_total", 1, { method, outcome });
      telemetry?.metric("adapter_rpc_duration", durationMs, { method, outcome }, "histogram");
    },
    traceRpc: (method, rpcContext, operation) =>
      telemetry?.traceAdapterRpc(
        method,
        {
          ...(rpcContext.taskId === undefined ? {} : { taskId: rpcContext.taskId }),
          ...(rpcContext.externalExecutionId === undefined
            ? {}
            : { externalExecutionId: rpcContext.externalExecutionId }),
          ...(rpcContext.operationName === undefined
            ? {}
            : { operationName: rpcContext.operationName }),
          ...(rpcContext.commandSequence === undefined
            ? {}
            : { commandSequence: rpcContext.commandSequence }),
        },
        operation,
        rpcContext.traceparent === undefined
          ? undefined
          : {
              traceparent: rpcContext.traceparent,
              ...(rpcContext.tracestate === undefined ? {} : { tracestate: rpcContext.tracestate }),
            },
      ) ?? operation(new grpc.Metadata()),
    traceStreamRpc: (method, rpcContext, open) =>
      telemetry?.traceAdapterStreamRpc(
        method,
        rpcContext.sourceId === undefined ? {} : { sourceId: rpcContext.sourceId },
        open,
      ) ?? open(new grpc.Metadata()),
  });
  const dependencies: RuntimeDependencies = {
    database: "starting",
    adapter: "starting",
    adapterManifest: "starting",
    recovery: "starting",
    scheduler: "starting",
    commandDispatcher: "starting",
    ttlCleaner: "starting",
    outboxPublisher: "starting",
    outboxCleaner: "starting",
    providerTelemetryIngress: config.PROVIDER_TELEMETRY_INGRESS_ENABLED ? "starting" : "ready",
    businessEventPersistence: config.BUSINESS_EVENTS_ENABLED ? "starting" : "disabled",
    businessEventReplay: config.BUSINESS_EVENTS_ENABLED ? "starting" : "disabled",
    businessEventIngest: config.BUSINESS_EVENTS_ENABLED ? "starting" : "disabled",
    businessEventFinalizer: config.BUSINESS_EVENTS_ENABLED ? "starting" : "disabled",
    businessEventAdapterSources: {},
    businessEventRetention: config.BUSINESS_EVENTS_ENABLED ? "starting" : "disabled",
    businessEventProjection: config.BUSINESS_EVENTS_ENABLED ? "starting" : "disabled",
  };
  let manifest: ProviderManifest | undefined;
  let mcpRouter: ProtocolRouter | undefined;
  let schedulerTimer: NodeJS.Timeout | undefined;
  let recoveryTimer: NodeJS.Timeout | undefined;
  let commandDispatcherTimer: NodeJS.Timeout | undefined;
  let ttlCleanerTimer: NodeJS.Timeout | undefined;
  let outboxCleanerTimer: NodeJS.Timeout | undefined;
  let adapterHealthTimer: NodeJS.Timeout | undefined;
  let adapterManifestTimer: NodeJS.Timeout | undefined;
  let outboxPublisherTimer: NodeJS.Timeout | undefined;
  let providerOpsPublisherTimer: NodeJS.Timeout | undefined;
  const businessEventRetryTimers = new Set<NodeJS.Timeout>();
  let businessEventWorkersStopping = false;
  let schedulerTicking = false;
  let recoveryTicking = false;
  let commandDispatcherTicking = false;
  let ttlCleanerTicking = false;
  let outboxCleanerTicking = false;
  let adapterHealthTicking = false;
  let adapterManifestTicking = false;
  let outboxPublisherTicking = false;
  let providerOpsPublisherTicking = false;
  let adapterHealthFailures = 0;
  const rateLimiter = new BoundedRateLimiter(
    config.RATE_LIMIT_MAX,
    config.RATE_LIMIT_WINDOW_MS,
    config.RATE_LIMIT_MAX_KEYS,
  );

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?", 1)[0];
    if (path !== "/mcp" && !(config.MCP_LEGACY_ENDPOINT_ENABLED && path === "/mcp/legacy")) return;
    if (!rateLimiter.consume(request.ip).allowed) {
      metrics.increment("sdar_rate_limited_total");
      return reply.code(429).send({ error: "rate_limit_exceeded" });
    }
  });

  app.get("/health/live", () => ({ status: "live" }));
  app.get("/health/ready", async (_request, reply) => {
    if (dependencies.database !== "starting") {
      try {
        await pool.query("SELECT 1");
        dependencies.database = "ready";
      } catch {
        dependencies.database = "failed";
      }
    }
    const coreStatuses = [
      dependencies.database,
      dependencies.adapter,
      dependencies.adapterManifest,
      dependencies.recovery,
      dependencies.scheduler,
      dependencies.commandDispatcher,
      dependencies.ttlCleaner,
      dependencies.outboxPublisher,
      dependencies.outboxCleaner,
      dependencies.providerTelemetryIngress,
    ];
    const businessEventStatuses = [
      dependencies.businessEventPersistence,
      dependencies.businessEventReplay,
      dependencies.businessEventIngest,
      dependencies.businessEventFinalizer,
      dependencies.businessEventRetention,
      dependencies.businessEventProjection,
      ...Object.values(dependencies.businessEventAdapterSources),
    ];
    const ready =
      coreStatuses.every((status) => status === "ready") &&
      (!config.BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY ||
        businessEventStatuses.every((status) => status === "ready"));
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? "ready" : "not_ready", dependencies });
  });
  app.get("/metrics", async (_request, reply) => {
    const taskStates = await pool.query<{ internal_state: string; count: string }>(
      "SELECT internal_state, count(*) FROM provider_task GROUP BY internal_state",
    );
    const pendingOutbox = await pool.query<{ count: string }>(
      "SELECT count(*) FROM outbox_event WHERE published_at IS NULL",
    );
    const telemetryDelivery = await pool.query<{ backlog: string; oldest_age_seconds: string }>(
      `SELECT count(*) FILTER (WHERE state IN ('PENDING','CLAIMED','RETRY_WAIT'))::text AS backlog,
              COALESCE(EXTRACT(EPOCH FROM clock_timestamp()-min(created_at)
                FILTER (WHERE state IN ('PENDING','CLAIMED','RETRY_WAIT'))),0)::text
                AS oldest_age_seconds
       FROM provider_ops_delivery`,
    );
    const gauges: Record<string, number> = {
      sdar_outbox_pending: Number(pendingOutbox.rows[0]?.count ?? 0),
      telemetry_audit_backlog: Number(telemetryDelivery.rows[0]?.backlog ?? 0),
      telemetry_audit_oldest_age_seconds: Number(
        telemetryDelivery.rows[0]?.oldest_age_seconds ?? 0,
      ),
      ...telemetrySelfGauges,
    };
    for (const row of taskStates.rows) {
      gauges[`sdar_task_state{state="${row.internal_state}"}`] = Number(row.count);
    }
    if (config.BUSINESS_EVENTS_ENABLED) {
      const businessEventSnapshot = await pool.query<{
        inbox_backlog: string;
        oldest_pending_mapping_age_seconds: string;
        active_relation_tokens: string;
      }>(
        `SELECT
           (SELECT count(*) FROM adapter_business_event_inbox
             WHERE status IN ('received','pending_mapping','ready'))::text AS inbox_backlog,
           COALESCE((SELECT EXTRACT(EPOCH FROM clock_timestamp()-min(received_at))
             FROM adapter_business_event_inbox WHERE status='pending_mapping'),0)::text
             AS oldest_pending_mapping_age_seconds,
           (SELECT count(*) FROM provider_business_event_relation_projection
             WHERE expires_at>clock_timestamp())::text AS active_relation_tokens`,
      );
      const snapshot = businessEventSnapshot.rows[0];
      const operationalGauges = {
        sdar_business_event_inbox_backlog: Number(snapshot?.inbox_backlog ?? 0),
        sdar_business_event_oldest_pending_mapping_age_seconds: Number(
          snapshot?.oldest_pending_mapping_age_seconds ?? 0,
        ),
        sdar_business_event_active_relation_tokens: Number(snapshot?.active_relation_tokens ?? 0),
      };
      Object.assign(gauges, operationalGauges);
      for (const [name, value] of Object.entries(operationalGauges)) {
        telemetry?.metric(name, value, {}, "gauge");
      }
    }
    return reply.type("text/plain; version=0.0.4").send(metrics.render(gauges));
  });
  app.get("/internal/provider", async (_request, reply) => {
    if (!config.INTERNAL_ENDPOINTS_ENABLED) {
      return reply.code(404).send({ error: "internal_endpoints_disabled" });
    }
    const header =
      typeof _request.headers["x-sdar-admin-token"] === "string"
        ? _request.headers["x-sdar-admin-token"]
        : "";
    if (header.length === 0) {
      return reply.code(401).send({ error: "admin_token_required" });
    }
    if (!isValidInternalAdminToken(header, config.INTERNAL_ADMIN_TOKEN ?? "")) {
      return reply.code(403).send({ error: "invalid_admin_token" });
    }
    if (manifest === undefined) return reply.code(503).send({ error: "manifest_not_loaded" });
    return manifest;
  });
  const handleMcp = async (
    path: "/mcp" | "/mcp/legacy",
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> => {
    if (request.method !== "POST") {
      return reply.code(405).send({
        jsonrpc: "2.0",
        error: { code: -32_000, message: "Method not allowed." },
        id: null,
      });
    }
    if (path === "/mcp/legacy" && !config.MCP_LEGACY_ENDPOINT_ENABLED) {
      return reply.code(404).send({ error: "legacy_mcp_disabled" });
    }
    if (mcpRouter === undefined) {
      return reply.code(503).send({
        jsonrpc: "2.0",
        error: { code: -32_003, message: "Provider not ready." },
        id: null,
      });
    }
    try {
      resolveAuthorization(request.raw);
    } catch {
      return reply.code(401).send({ error: "authentication_failed" });
    }
    reply.hijack();
    const handled = await mcpRouter.handle(path, request.raw, reply.raw, request.body);
    if (!handled && !reply.raw.headersSent) {
      reply.raw.statusCode = 404;
      reply.raw.end(JSON.stringify({ error: "mcp_route_not_found" }));
    }
    return undefined;
  };
  app.all("/mcp", (request, reply) => handleMcp("/mcp", request, reply));
  app.all("/mcp/legacy", (request, reply) => handleMcp("/mcp/legacy", request, reply));

  app.addHook("onClose", async () => {
    if (schedulerTimer !== undefined) clearInterval(schedulerTimer);
    if (recoveryTimer !== undefined) clearInterval(recoveryTimer);
    if (commandDispatcherTimer !== undefined) clearInterval(commandDispatcherTimer);
    if (ttlCleanerTimer !== undefined) clearInterval(ttlCleanerTimer);
    if (outboxCleanerTimer !== undefined) clearInterval(outboxCleanerTimer);
    if (adapterHealthTimer !== undefined) clearInterval(adapterHealthTimer);
    if (adapterManifestTimer !== undefined) clearInterval(adapterManifestTimer);
    if (outboxPublisherTimer !== undefined) clearInterval(outboxPublisherTimer);
    if (providerOpsPublisherTimer !== undefined) clearInterval(providerOpsPublisherTimer);
    businessEventWorkersStopping = true;
    for (const timer of businessEventRetryTimers) clearTimeout(timer);
    businessEventRetryTimers.clear();
    for (const sourceId of businessEventSourceIds) {
      businessEventTelemetry?.gauge("sdar_business_event_publication_barrier_waiting", 0, {
        sourceId,
      });
    }
    gateway.close();
    await providerTelemetryServer?.close();
    await telemetry?.shutdown();
    await pool.end();
  });

  function initializeProviderTelemetry(validated: ValidatedManifest): void {
    if (telemetry !== undefined) return;
    try {
      const security = loadOtlpExporterSecurity(config);
      const candidate = new ProviderTelemetry({
        enabled: config.OTEL_ENABLED,
        otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
        otlpTimeoutMillis: config.OTEL_EXPORTER_OTLP_TIMEOUT_MS,
        ...security,
        boundedDynamicMetricValues: {
          sourceId: new Set(validated.businessEventSources.map((source) => source.sourceId)),
        },
        resource: {
          serviceVersion: RUNTIME_VERSION,
          instanceId: telemetryInstanceId,
          deploymentEnvironment: config.RUNTIME_ENV,
          providerId: validated.providerId,
          providerVersion: validated.providerVersion,
        },
        onSelfMetric: (name, value, attributes, kind) => {
          const labels = Object.fromEntries(
            Object.entries(attributes).map(([key, label]) => [key, String(label)]),
          );
          const metricName = prometheusMetricKey(name, labels);
          if (kind === "gauge") telemetrySelfGauges[metricName] = value;
          else metrics.increment(name, labels, value);
        },
      });
      candidate.start();
      telemetry = candidate;
    } catch (error) {
      logger.warn({ err: error }, "Provider telemetry initialization failed");
    }
  }

  async function initialize(): Promise<ProviderManifest> {
    try {
      await runMigrations(pool);
      await pool.query("SELECT 1 AS runtime_database_ready");
      dependencies.database = "ready";
    } catch (error) {
      dependencies.database = "failed";
      throw error;
    }

    try {
      manifest = await gateway.describeProvider();
      if (manifest.providerId !== config.PROVIDER_ID) {
        throw new Error(
          `Adapter provider id ${manifest.providerId} does not match configured ${config.PROVIDER_ID}`,
        );
      }
      const validated = new OperationRegistry().validate(manifest);
      if (config.BUSINESS_EVENTS_ENABLED && validated.businessEventSources.length === 0) {
        throw new Error("BUSINESS_EVENTS_ENABLED_REQUIRES_SOURCE");
      }
      if (config.BUSINESS_EVENTS_ENABLED) {
        for (const source of validated.businessEventSources) {
          if (
            BigInt(source.maxEventBytes) > BigInt(config.BUSINESS_EVENTS_MAX_EVENT_BYTES) ||
            source.maxPayloadDepth > config.BUSINESS_EVENTS_MAX_PAYLOAD_DEPTH ||
            source.maxPayloadNodes > config.BUSINESS_EVENTS_MAX_PAYLOAD_NODES ||
            BigInt(source.maxPayloadStringBytes) >
              BigInt(config.BUSINESS_EVENTS_MAX_PAYLOAD_STRING_BYTES)
          ) {
            throw new Error("BUSINESS_EVENT_SOURCE_LIMIT_EXCEEDS_RUNTIME");
          }
          if (
            source.deliverySemantics === "durable_at_least_once" &&
            BigInt(source.sourceRetentionMs) <
              BigInt(
                config.BUSINESS_EVENT_MAPPING_DEADLINE_MS +
                  config.BUSINESS_EVENT_MAX_FUTURE_SKEW_MS +
                  config.BUSINESS_EVENT_CLOCK_SKEW_SAFETY_MS,
              )
          ) {
            throw new Error("BUSINESS_EVENT_SOURCE_RETENTION_INSUFFICIENT");
          }
          dependencies.businessEventAdapterSources[source.sourceId] = "starting";
        }
      }
      initializeProviderTelemetry(validated);
      businessEventSourceIds = validated.businessEventSources.map((source) => source.sourceId);
      const businessEventMetricPolicy = new BusinessEventMetricPolicy(businessEventSourceIds);
      businessEventTelemetry = new BusinessEventTelemetryBridge(
        metrics,
        telemetry,
        businessEventMetricPolicy,
        telemetrySelfGauges,
      );
      const businessEventMetrics = businessEventTelemetry;
      const businessEventRepository = new BusinessEventRepository(pool, {
        ...(config.BUSINESS_EVENTS_ENABLED
          ? {
              providerOpsRecorder: new BusinessEventProviderOpsRecorder({
                runtimeVersion: RUNTIME_VERSION,
                instanceId: telemetryInstanceId,
              }),
            }
          : {}),
      });
      const businessEventManager = config.BUSINESS_EVENTS_ENABLED
        ? new BusinessEventNotificationManager(validated.providerId, businessEventRepository, {
            pollIntervalMs: config.BUSINESS_EVENTS_POLL_INTERVAL_MS,
            replayBatchSize: config.BUSINESS_EVENTS_REPLAY_BATCH_SIZE,
            maxQueueMessages: config.BUSINESS_EVENTS_MAX_QUEUE_MESSAGES,
            maxQueueBytes: config.BUSINESS_EVENTS_MAX_QUEUE_BYTES,
            maxStreamDurationMs: config.BUSINESS_EVENTS_MAX_STREAM_DURATION_MS,
            maxSubscriptions: config.BUSINESS_EVENTS_MAX_SUBSCRIPTIONS,
            maxSubscriptionsPerAuth: config.BUSINESS_EVENTS_MAX_SUBSCRIPTIONS_PER_AUTH,
            metrics: businessEventMetrics,
          })
        : undefined;
      const businessEventDiscovery =
        businessEventManager === undefined
          ? undefined
          : await (async () => {
              await businessEventRepository.initializeProvider(
                validated.providerId,
                validated.businessEventSources.map((source) => ({
                  sourceId: source.sourceId,
                  sourceStreamId: source.sourceStreamId,
                  deliverySemantics: source.deliverySemantics,
                })),
                config.BUSINESS_EVENTS_RETENTION_MS,
              );
              dependencies.businessEventPersistence = "ready";
              dependencies.businessEventReplay = "ready";
              dependencies.businessEventIngest = "ready";
              dependencies.businessEventFinalizer = "ready";
              dependencies.businessEventRetention = "ready";
              dependencies.businessEventProjection = "ready";
              return businessEventManager.discovery(config.BUSINESS_EVENTS_RETENTION_MS);
            })();
      const businessEventRelationManager = config.BUSINESS_EVENTS_ENABLED
        ? new BusinessEventRelationManager(
            validated.providerId,
            businessEventRepository,
            300_000,
            businessEventMetrics,
          )
        : undefined;
      if (config.BUSINESS_EVENTS_ENABLED) {
        for (const source of validated.businessEventSources) {
          const worker = new AdapterBusinessEventSourceClient(businessEventRepository, gateway, {
            providerId: validated.providerId,
            sourceId: source.sourceId,
            sourceStreamId: source.sourceStreamId,
            deliverySemantics: source.deliverySemantics,
            replicaId: telemetryInstanceId,
            inboxRetentionMs: config.BUSINESS_EVENTS_RETENTION_MS,
            eventRetentionMs: config.BUSINESS_EVENTS_RETENTION_MS,
            generationRetentionMs: config.BUSINESS_EVENTS_RETENTION_MS,
            mappingDeadlineMs: config.BUSINESS_EVENT_MAPPING_DEADLINE_MS,
            metrics: businessEventMetrics,
          });
          const run = async (): Promise<void> => {
            if (businessEventWorkersStopping) return;
            dependencies.businessEventAdapterSources[source.sourceId] = "ready";
            try {
              const outcome = await worker.runOnce();
              if (outcome === "degraded") {
                dependencies.businessEventAdapterSources[source.sourceId] = "degraded";
              }
            } catch {
              dependencies.businessEventAdapterSources[source.sourceId] = "degraded";
              businessEventMetrics.increment("sdar_business_event_source_blocked_total", {
                sourceId: source.sourceId,
                reason: "worker_failure",
              });
            }
            // The close hook mutates this flag asynchronously while the stream is awaited.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (!businessEventWorkersStopping) {
              const timer = setTimeout(() => {
                businessEventRetryTimers.delete(timer);
                void run();
              }, config.BUSINESS_EVENTS_POLL_INTERVAL_MS);
              timer.unref();
              businessEventRetryTimers.add(timer);
            }
          };
          void run();
        }
      }
      dependencies.adapter = "ready";
      const manifestWatcher = new AdapterManifestWatcher(gateway, validated.manifestHash);
      dependencies.adapterManifest = "ready";
      const snapshotIds = await new OperationSnapshotRepository(pool).saveManifest(validated);
      const taskEngine = new TaskEngine(
        validated,
        snapshotIds,
        gateway,
        new TaskRepository(pool),
        new IdempotencyRepository(pool, () => metrics.increment("sdar_idempotency_hits_total"), {
          leaseMs: config.IDEMPOTENCY_LEASE_MS,
          waitTimeoutMs: config.IDEMPOTENCY_WAIT_TIMEOUT_MS,
          pollMs: config.IDEMPOTENCY_POLL_MS,
        }),
        undefined,
        metrics,
        (event) => logger.info(event, "task trace"),
      );
      const legacyHandler = new LegacyMcpProtocolHandler(validated, gateway, taskEngine, {
        resolveAuthorization,
        maxArgumentBytes: config.ARGUMENT_MAX_BYTES,
        maxJsonDepth: config.ARGUMENT_MAX_DEPTH,
        maxJsonNodes: config.ARGUMENT_MAX_NODES,
        traceRequest: (name, headers, action) =>
          telemetry?.traceRequest(
            name,
            headers,
            { "sdar.provider.id": validated.providerId },
            action,
          ) ?? action(),
        currentTraceContext: () => telemetry?.currentTraceContext() ?? null,
        onProtocolError: (error, correlationId) =>
          logger.error({ err: error, correlationId }, "MCP technical request failure"),
      });
      const frozenHandler = new Sep2663ProtocolHandler(
        validated,
        RUNTIME_VERSION,
        taskEngine,
        resolveAuthorization,
        new TaskNotificationStream(taskEngine, {
          pollIntervalMs: config.TASK_NOTIFICATION_POLL_INTERVAL_MS,
          maxSubscriptions: config.TASK_NOTIFICATION_MAX_SUBSCRIPTIONS,
          maxSubscriptionsPerAuth: config.TASK_NOTIFICATION_MAX_SUBSCRIPTIONS_PER_AUTH,
          maxTaskBindings: config.TASK_NOTIFICATION_MAX_TASK_BINDINGS,
          maxQueueMessages: config.TASK_NOTIFICATION_MAX_QUEUE_MESSAGES,
          maxQueueBytes: config.TASK_NOTIFICATION_MAX_QUEUE_BYTES,
          batchSize: config.TASK_NOTIFICATION_BATCH_SIZE,
          metrics: {
            increment: (name, labels = {}, amount = 1) => metrics.increment(name, labels, amount),
            gauge: (name, value) => {
              telemetrySelfGauges[name] = value;
            },
          },
        }),
        businessEventManager,
        businessEventDiscovery,
        businessEventRelationManager,
      );
      mcpRouter = new ProtocolRouter(
        frozenHandler,
        legacyHandler,
        config.MCP_LEGACY_ENDPOINT_ENABLED,
      );
      const taskRepository = new TaskRepository(pool);
      if (
        config.PROVIDER_TELEMETRY_INGRESS_ENABLED &&
        dependencies.providerTelemetryIngress !== "ready"
      ) {
        providerTelemetryServer ??= new ProviderTelemetryGrpcServer(
          new ProviderTelemetryIngress(pool, {
            providerId: validated.providerId,
            runtimeVersion: RUNTIME_VERSION,
            instanceId: telemetryInstanceId,
            maxBatch: config.PROVIDER_TELEMETRY_MAX_BATCH,
            maxEventBytes: config.PROVIDER_TELEMETRY_MAX_EVENT_BYTES,
            maxDepth: config.PROVIDER_TELEMETRY_MAX_DEPTH,
            maxNodes: config.PROVIDER_TELEMETRY_MAX_NODES,
            rateLimit: config.PROVIDER_TELEMETRY_RATE_LIMIT,
            traceEvent: (traceContext, operation) =>
              telemetry?.traceProviderEvent(traceContext, operation) ?? operation(),
          }),
          {
            host: config.PROVIDER_TELEMETRY_HOST,
            port: config.PROVIDER_TELEMETRY_PORT,
            tlsMode: config.PROVIDER_TELEMETRY_TLS_MODE,
            ...(config.PROVIDER_TELEMETRY_TLS_CA_PATH === undefined
              ? {}
              : { tlsCaPath: config.PROVIDER_TELEMETRY_TLS_CA_PATH }),
            ...(config.PROVIDER_TELEMETRY_TLS_CERT_PATH === undefined
              ? {}
              : { tlsCertPath: config.PROVIDER_TELEMETRY_TLS_CERT_PATH }),
            ...(config.PROVIDER_TELEMETRY_TLS_KEY_PATH === undefined
              ? {}
              : { tlsKeyPath: config.PROVIDER_TELEMETRY_TLS_KEY_PATH }),
          },
        );
        try {
          await providerTelemetryServer.start();
          dependencies.providerTelemetryIngress = "ready";
        } catch (error) {
          dependencies.providerTelemetryIngress = "failed";
          await providerTelemetryServer.close();
          providerTelemetryServer = undefined;
          throw error;
        }
      }
      const scheduler = new DurableScheduler(
        validated,
        gateway,
        taskRepository,
        undefined,
        undefined,
        config.SCHEDULE_CLAIM_LEASE_MS,
        undefined,
        {
          concurrency: config.SCHEDULER_CONCURRENCY,
          leaseMilliseconds: config.SCHEDULE_CLAIM_LEASE_MS,
          onEvent: (decision, amount) =>
            telemetry?.metric("provider_scheduler_total", amount, { decision }),
        },
      );
      const commandDispatcher = new DurableCommandDispatcher(
        gateway,
        taskRepository,
        undefined,
        undefined,
        undefined,
        config.COMMAND_CLAIM_LEASE_MS,
        undefined,
        {
          concurrency: config.COMMAND_DISPATCH_CONCURRENCY,
          leaseMilliseconds: config.COMMAND_CLAIM_LEASE_MS,
          onMetric: (durationMs) =>
            telemetry?.metric("command_dispatch_duration", durationMs, {}, "histogram"),
        },
      );
      const outboxCleaner = new OutboxCleaner(taskRepository, {
        publishedRetentionMs: config.OUTBOX_PUBLISHED_RETENTION_MS,
        onMetric: (outcome, amount) =>
          metrics.increment("sdar_outbox_cleaner_total", { outcome }, amount),
      });
      const ttlCleaner = new TtlCleaner(taskRepository, {
        batchSize: config.TTL_CLEANER_BATCH_SIZE,
        purgeGraceMs: config.TTL_PURGE_GRACE_MS,
        recoveryLeaseMs: config.RECOVERY_LEASE_MS,
        onMetric: (outcome, amount) =>
          metrics.increment("sdar_ttl_cleaner_total", { outcome }, amount),
      });
      const downstreamOutboxSink =
        config.OUTBOX_SINK === "webhook"
          ? new WebhookOutboxSink(
              new URL(requiredOutboxWebhookUrl(config)),
              config.OUTBOX_WEBHOOK_TIMEOUT_MS,
            )
          : new InternalNoopOutboxSink();
      const outboxPublisher = new OutboxPublisher(
        new OutboxRepository(pool),
        downstreamOutboxSink,
        config.OUTBOX_BATCH_SIZE,
      );
      const providerOpsPublisher = new DurableProviderOpsPublisher(
        new ProviderOpsDeliveryRepository(pool),
        {
          export: async (records) =>
            telemetry?.exportAudit(
              records.map((record) => ({
                ...record.recordBody,
                instanceId: telemetryInstanceId,
                emittedAt: new Date().toISOString(),
              })),
            ) ?? Promise.reject(new Error("TELEMETRY_AUDIT_EXPORT_UNAVAILABLE")),
        },
        telemetryInstanceId,
        {
          onEvent: (event, amount) => {
            if (event === "retry") {
              telemetry?.metric("telemetry_audit_retry_total", amount, {
                signal: "audit",
                reason: "exporter_error",
              });
              metrics.increment("telemetry_audit_retry_total", {}, amount);
            } else {
              telemetry?.metric("provider_telemetry_delivery_total", amount, { event });
            }
          },
        },
      );
      const recovery = new RecoveryManager(
        taskEngine,
        taskRepository,
        config.RECOVERY_LEASE_MS,
        (error, taskId) => {
          telemetry?.metric("provider_error_total", 1, { source: "recovery" });
          logger.warn(
            { err: error, taskId, providerId: validated.providerId },
            "task recovery deferred",
          );
        },
        (event, amount) => {
          telemetry?.metric("provider_recovery_total", amount, { event });
        },
      );
      const recoveryStartedAt = performance.now();
      const recovered = await recovery.scan();
      telemetry?.metric(
        "recovery_duration",
        performance.now() - recoveryStartedAt,
        {},
        "histogram",
      );
      metrics.increment("sdar_recovery_total", { outcome: "scan" });
      dependencies.recovery = "ready";
      logger.info(
        { recovery: recovered, providerId: validated.providerId },
        "startup recovery scanned",
      );
      await scheduler.tick();
      dependencies.scheduler = "ready";
      await commandDispatcher.tick();
      dependencies.commandDispatcher = "ready";
      await outboxCleaner.tick();
      dependencies.outboxCleaner = "ready";
      await ttlCleaner.tick();
      dependencies.ttlCleaner = "ready";
      await outboxPublisher.tick();
      dependencies.outboxPublisher = "ready";
      await providerOpsPublisher.tick().catch((error: unknown) => {
        logger.warn({ err: error }, "Provider telemetry delivery deferred");
      });
      await updateOperationalGauges(pool, telemetry);
      schedulerTimer = setInterval(() => {
        if (schedulerTicking) return;
        schedulerTicking = true;
        void scheduler
          .tick()
          .then(() => {
            dependencies.scheduler = "ready";
            void updateOperationalGauges(pool, telemetry);
          })
          .catch((error: unknown) => {
            dependencies.scheduler = "failed";
            logger.error({ err: error }, "scheduler tick failed");
          })
          .finally(() => {
            schedulerTicking = false;
          });
      }, config.SCHEDULER_POLL_MS);
      schedulerTimer.unref();
      commandDispatcherTimer = setInterval(() => {
        if (commandDispatcherTicking) return;
        commandDispatcherTicking = true;
        void commandDispatcher
          .tick()
          .then(() => {
            dependencies.commandDispatcher = "ready";
          })
          .catch((error: unknown) => {
            dependencies.commandDispatcher = "failed";
            logger.error({ err: error }, "command dispatcher tick failed");
          })
          .finally(() => {
            commandDispatcherTicking = false;
          });
      }, config.SCHEDULER_POLL_MS);
      commandDispatcherTimer.unref();
      outboxCleanerTimer = setInterval(() => {
        if (outboxCleanerTicking) return;
        outboxCleanerTicking = true;
        void outboxCleaner
          .tick()
          .then(() => {
            dependencies.outboxCleaner = "ready";
          })
          .catch((error: unknown) => {
            dependencies.outboxCleaner = "failed";
            logger.error({ err: error }, "outbox cleaner tick failed");
          })
          .finally(() => {
            outboxCleanerTicking = false;
          });
      }, config.OUTBOX_CLEANER_POLL_MS);
      outboxCleanerTimer.unref();
      ttlCleanerTimer = setInterval(() => {
        if (ttlCleanerTicking) return;
        ttlCleanerTicking = true;
        void ttlCleaner
          .tick()
          .then(() => {
            dependencies.ttlCleaner = "ready";
          })
          .catch((error: unknown) => {
            dependencies.ttlCleaner = "failed";
            logger.error({ err: error }, "TTL cleaner tick failed");
          })
          .finally(() => {
            ttlCleanerTicking = false;
          });
      }, config.TTL_CLEANER_POLL_MS);
      ttlCleanerTimer.unref();
      outboxPublisherTimer = setInterval(() => {
        if (outboxPublisherTicking) return;
        outboxPublisherTicking = true;
        void outboxPublisher
          .tick()
          .then(() => {
            dependencies.outboxPublisher = "ready";
          })
          .catch((error: unknown) => {
            dependencies.outboxPublisher = "failed";
            logger.error({ err: error }, "Outbox publisher tick failed");
          })
          .finally(() => {
            outboxPublisherTicking = false;
          });
      }, config.OUTBOX_POLL_MS);
      outboxPublisherTimer.unref();
      providerOpsPublisherTimer = setInterval(() => {
        if (providerOpsPublisherTicking) return;
        providerOpsPublisherTicking = true;
        void providerOpsPublisher
          .tick()
          .catch((error: unknown) => {
            logger.warn({ err: error }, "Provider telemetry delivery deferred");
          })
          .finally(() => {
            providerOpsPublisherTicking = false;
          });
      }, config.OUTBOX_POLL_MS);
      providerOpsPublisherTimer.unref();
      recoveryTimer = setInterval(() => {
        if (recoveryTicking) return;
        recoveryTicking = true;
        void recovery
          .scan()
          .then((scan) => {
            dependencies.recovery = "ready";
            metrics.increment("sdar_recovery_total", { outcome: "scan" });
            logger.debug({ recovery: scan, providerId: validated.providerId }, "recovery scanned");
          })
          .catch((error: unknown) => {
            dependencies.recovery = "failed";
            metrics.increment("sdar_recovery_total", { outcome: "error" });
            logger.error({ err: error, providerId: validated.providerId }, "recovery scan failed");
          })
          .finally(() => {
            recoveryTicking = false;
          });
      }, config.RECOVERY_POLL_MS);
      recoveryTimer.unref();
      adapterHealthTimer = setInterval(() => {
        if (adapterHealthTicking) return;
        adapterHealthTicking = true;
        void gateway
          .describeProvider()
          .then((description) => {
            if (description.providerId !== config.PROVIDER_ID) {
              throw new Error("ADAPTER_HEALTH_IDENTITY_MISMATCH");
            }
            adapterHealthFailures = 0;
            dependencies.adapter = "ready";
          })
          .catch((error: unknown) => {
            adapterHealthFailures += 1;
            if (adapterHealthFailures >= config.ADAPTER_HEALTH_FAILURE_THRESHOLD) {
              dependencies.adapter = "failed";
            }
            logger.warn(
              { err: error, failures: adapterHealthFailures },
              "Adapter health probe failed",
            );
          })
          .finally(() => {
            adapterHealthTicking = false;
          });
      }, config.ADAPTER_HEALTH_POLL_MS);
      adapterHealthTimer.unref();
      adapterManifestTimer = setInterval(() => {
        if (adapterManifestTicking) return;
        adapterManifestTicking = true;
        void manifestWatcher
          .tick()
          .then(() => {
            dependencies.adapterManifest = "ready";
          })
          .catch((error: unknown) => {
            dependencies.adapterManifest = "failed";
            logger.error({ err: error }, "Adapter Manifest drift check failed");
          })
          .finally(() => {
            adapterManifestTicking = false;
          });
      }, config.ADAPTER_MANIFEST_POLL_MS);
      adapterManifestTimer.unref();
    } catch (error) {
      if (dependencies.adapter === "starting") dependencies.adapter = "failed";
      throw error;
    }

    logger.info(
      { providerId: manifest.providerId, providerVersion: manifest.providerVersion },
      "runtime dependencies initialized",
    );
    return manifest;
  }

  return { app, gateway, pool, dependencies, initialize };
}

function requiredOutboxWebhookUrl(config: RuntimeConfig): string {
  if (config.OUTBOX_WEBHOOK_URL === undefined) throw new Error("OUTBOX_WEBHOOK_URL_REQUIRED");
  return config.OUTBOX_WEBHOOK_URL;
}

async function updateOperationalGauges(
  pool: Pool,
  telemetry: ProviderTelemetry | undefined,
): Promise<void> {
  if (telemetry === undefined) return;
  try {
    const counts = await pool.query<{
      active_tasks: string;
      pending_commands: string;
      outbox_pending: string;
      recovery_backlog: string;
      telemetry_audit_backlog: string;
      telemetry_audit_oldest_age_seconds: string;
    }>(`SELECT
      (SELECT count(*) FROM provider_task WHERE internal_state NOT LIKE 'TERMINAL_%')::text
        AS active_tasks,
      (SELECT count(*) FROM task_command WHERE state IN ('PENDING','CLAIMED','RETRY_WAIT'))::text
        AS pending_commands,
      (SELECT count(*) FROM outbox_event WHERE published_at IS NULL)::text AS outbox_pending,
      ((SELECT count(*) FROM admission_intent WHERE state IN ('PENDING','UNCERTAIN')) +
       (SELECT count(*) FROM provider_task
        WHERE internal_state NOT LIKE 'TERMINAL_%' AND next_recovery_at <= clock_timestamp()))::text
        AS recovery_backlog,
      (SELECT count(*) FROM provider_ops_delivery
       WHERE state IN ('PENDING','CLAIMED','RETRY_WAIT'))::text AS telemetry_audit_backlog,
      (SELECT COALESCE(EXTRACT(EPOCH FROM clock_timestamp()-min(created_at)),0)
       FROM provider_ops_delivery
       WHERE state IN ('PENDING','CLAIMED','RETRY_WAIT'))::text
        AS telemetry_audit_oldest_age_seconds`);
    const row = counts.rows[0];
    if (row === undefined) return;
    telemetry.metric("active_tasks", Number(row.active_tasks), {}, "gauge");
    telemetry.metric("pending_commands", Number(row.pending_commands), {}, "gauge");
    telemetry.metric("outbox_pending", Number(row.outbox_pending), {}, "gauge");
    telemetry.metric("recovery_backlog", Number(row.recovery_backlog), {}, "gauge");
    telemetry.metric("telemetry_audit_backlog", Number(row.telemetry_audit_backlog), {}, "gauge");
    telemetry.metric(
      "telemetry_audit_oldest_age_seconds",
      Number(row.telemetry_audit_oldest_age_seconds),
      {},
      "gauge",
    );
  } catch {
    // Metrics collection is best effort and never affects Runtime readiness or Task state.
  }
}

function authenticationOptions(config: RuntimeConfig): AuthenticationOptions {
  if (config.AUTH_MODE === "development") return { mode: "development" };
  if (config.AUTH_MODE === "trusted_headers") return { mode: "trusted_headers" };
  if (config.JWT_HS256_SECRET === undefined) throw new Error("JWT_HS256_SECRET_REQUIRED");
  return {
    mode: "jwt_hs256",
    secret: config.JWT_HS256_SECRET,
    ...(config.JWT_ISSUER === undefined ? {} : { issuer: config.JWT_ISSUER }),
    ...(config.JWT_AUDIENCE === undefined ? {} : { audience: config.JWT_AUDIENCE }),
  };
}

function adapterCredentials(config: RuntimeConfig): grpc.ChannelCredentials {
  if (config.ADAPTER_TLS_MODE === "disabled") return grpc.credentials.createInsecure();
  if (
    config.ADAPTER_TLS_CA_PATH === undefined ||
    config.ADAPTER_TLS_CERT_PATH === undefined ||
    config.ADAPTER_TLS_KEY_PATH === undefined
  ) {
    throw new Error("ADAPTER_MTLS_FILES_REQUIRED");
  }
  return grpc.credentials.createSsl(
    readFileSync(config.ADAPTER_TLS_CA_PATH),
    readFileSync(config.ADAPTER_TLS_KEY_PATH),
    readFileSync(config.ADAPTER_TLS_CERT_PATH),
  );
}

function isValidInternalAdminToken(token: string, expected: string): boolean {
  const tokenDigest = adminTokenDigest(token);
  const expectedDigest = adminTokenDigest(expected);
  return timingSafeEqual(tokenDigest, expectedDigest);
}

function adminTokenDigest(token: string): Buffer {
  return createHash("sha256").update("sdar-internal-admin-token-v1").update(token).digest();
}

function prometheusMetricKey(name: string, labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return name;
  return `${name}{${entries
    .map(([key, value]) => `${key}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",")}}`;
}

export function loadOtlpExporterSecurity(config: RuntimeConfig): {
  otlpHeaders?: Record<string, string>;
  otlpTls?: { ca: Buffer; cert: Buffer; key: Buffer };
} {
  if (!config.OTEL_ENABLED) return {};
  let otlpHeaders: Record<string, string> | undefined;
  if (config.OTEL_EXPORTER_OTLP_HEADERS_FILE !== undefined) {
    const content = readFileSync(config.OTEL_EXPORTER_OTLP_HEADERS_FILE, "utf8");
    if (Buffer.byteLength(content, "utf8") > 65_536) throw new Error("OTLP_HEADERS_FILE_TOO_LARGE");
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("OTLP_HEADERS_FILE_INVALID");
    }
    otlpHeaders = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!/^[a-z0-9-]{1,128}$/i.test(key) || typeof value !== "string" || /[\r\n]/.test(value)) {
        throw new Error("OTLP_HEADERS_FILE_INVALID");
      }
      otlpHeaders[key] = value;
    }
  }
  let otlpTls: { ca: Buffer; cert: Buffer; key: Buffer } | undefined;
  if (config.OTEL_EXPORTER_OTLP_TLS_MODE === "required") {
    if (
      config.OTEL_EXPORTER_OTLP_CA_PATH === undefined ||
      config.OTEL_EXPORTER_OTLP_CERT_PATH === undefined ||
      config.OTEL_EXPORTER_OTLP_KEY_PATH === undefined
    ) {
      throw new Error("OTLP_MTLS_FILES_REQUIRED");
    }
    otlpTls = {
      ca: readFileSync(config.OTEL_EXPORTER_OTLP_CA_PATH),
      cert: readFileSync(config.OTEL_EXPORTER_OTLP_CERT_PATH),
      key: readFileSync(config.OTEL_EXPORTER_OTLP_KEY_PATH),
    };
  }
  return {
    ...(otlpHeaders === undefined ? {} : { otlpHeaders }),
    ...(otlpTls === undefined ? {} : { otlpTls }),
  };
}
