import { Pool } from "pg";
import { z } from "zod";
import { DeploymentProfile } from "../../../packages/vehicle-zmq-contract/src/index.js";
import {
  ObserverSettings,
  observerIdentity,
  PostgresObservationArchive,
  ZmqObservationObserver,
  ZmqSubscriptionDriver,
  canonical,
  sha256,
} from "../../../packages/vehicle-zmq-observer/src/index.js";
import {
  PostgresProviderStore,
  PostgresTaskBusinessStore,
  openGowmTaskBusinessStore,
  verifyNativeTaskBusinessSchema,
  VehicleProviderGrpcServer,
} from "../../../packages/provider-adapter-kit/src/index.js";
import {
  resolveDeviceContext,
  type GowmStorageConfig,
} from "../../../packages/gowm-shared-storage-adapter/src/index.js";
import { jsonToProtoStruct } from "../../../packages/adapter-protocol/src/index.js";
import {
  SITE_PROFILE,
  siteManifest,
} from "../../../packages/vehicle-zmq-control/src/site-catalog.js";
import { ZmqBusinessEvents, zmqBusiness } from "./business.js";
import { SiteReadonlyRuntime } from "./site-runtime.js";
import { SiteRoutePlanner } from "./site-planner.js";

export interface SiteReadonlyOptions {
  mode: "site_readonly";
  databaseUrl: string;
  observationDatabaseUrl: string;
  profile: unknown;
  observerSettings: unknown;
  contractSha256: string;
  plannerFrame?: "airport_south_positive_v1";
  gowm?: GowmStorageConfig;
  host?: string;
  port?: number;
}
export async function openSiteReadonlyProvider(options: SiteReadonlyOptions) {
  z.literal("site_readonly").parse(options.mode);
  const profile = DeploymentProfile.parse(options.profile),
    settings = ObserverSettings.parse(options.observerSettings);
  const contract = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(options.contractSha256);
  z.url().parse(options.databaseUrl);
  z.url().parse(options.observationDatabaseUrl);
  if (!profile.providerBinding.providerId || !profile.providerBinding.resourceId)
    throw Error("ZMQ_READONLY_LOGICAL_BINDING_REQUIRED");
  if (options.observationDatabaseUrl === options.gowm?.databaseUrl)
    throw Error("ZMQ_OBSERVATION_OWNER_DATABASE_REQUIRED");
  if (!["127.0.0.1", "0.0.0.0"].includes(options.host ?? "127.0.0.1"))
    throw Error("ZMQ_SITE_GRPC_HOST_INVALID");
  z.literal("airport_south_positive_v1").optional().parse(options.plannerFrame);
  const store = new PostgresProviderStore(options.databaseUrl, 8, "ugv", options.gowm);
  store.pool.options.query_timeout = settings.databaseTimeoutMs;
  store.pool.options.statement_timeout = settings.databaseTimeoutMs;
  store.pool.options.connectionTimeoutMillis = settings.databaseTimeoutMs;
  const pool = new Pool({
    connectionString: options.observationDatabaseUrl,
    max: 6,
    connectionTimeoutMillis: 500,
    query_timeout: 500,
    statement_timeout: 500,
  });
  const identity = observerIdentity(
    profile,
    settings.diagnosticPartition,
    sha256(canonical(profile)),
    contract,
  );
  const archive = new PostgresObservationArchive(pool, identity, settings),
    observer = new ZmqObservationObserver(profile, settings, identity, archive),
    driver = new ZmqSubscriptionDriver(observer, settings);
  let server: VehicleProviderGrpcServer<ReturnType<typeof observer.snapshot>> | undefined,
    closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await server?.close();
    await driver.stop();
    await observer.stop();
    await store.close();
    await pool.end();
  };
  try {
    // Both paths verify existing owner/schema contracts. They never install migrations.
    await store.initialize();
    if (options.gowm) {
      const binding = await resolveDeviceContext(
        store.pool,
        options.gowm,
        {
          providerId: profile.providerBinding.providerId,
          resourceId: profile.providerBinding.resourceId,
        },
        false,
      );
      if (profile.providerBinding.sourceSessionKey !== binding.sourceSessionKey)
        throw Error("ZMQ_READONLY_OWNER_SOURCE_MISMATCH");
    }
    const businessStore = options.gowm
      ? await openGowmTaskBusinessStore(store.pool, options.gowm)
      : new PostgresTaskBusinessStore(store.pool);
    if (!options.gowm) await verifyNativeTaskBusinessSchema(store.pool);
    store.enableTaskBusinessSource(businessStore);
    const events = new ZmqBusinessEvents(store),
      business = zmqBusiness(
        store,
        businessStore,
        profile.providerBinding.providerId,
        profile.providerBinding.resourceId,
        events,
      );
    const planner =
      profile.planner.policy === "retain" && profile.planner.endpoint && options.plannerFrame
        ? new SiteRoutePlanner(profile.planner.endpoint, pool)
        : undefined;
    const runtime = new SiteReadonlyRuntime(profile, observer, store, business, planner);
    await observer.start();
    await driver.start();
    server = new VehicleProviderGrpcServer(
      {
        host: options.host ?? "127.0.0.1",
        port: options.port ?? 0,
        tlsMode: "disabled",
        internalErrorCode: "ZMQ_PROVIDER_ERROR",
        manifest: () =>
          siteManifest(profile.providerBinding.providerId ?? "", runtime.resourceId, store),
        resource: (state) => ({
          resourceId: runtime.resourceId,
          resourceType: "isr.vehicle.ugv.zmq",
          displayName: "ZMQ 现场只读观测",
          enabled: true,
          health: state.archive.status === "running" ? "degraded" : "unknown",
          metadata: jsonToProtoStruct({
            qualification: "site_readonly",
            catalogProfile: SITE_PROFILE,
            controlAvailable: false,
            completeEvidence: false,
            deploymentBinding: "unqualified_diagnostic",
          }),
          lastSeenAt: {
            seconds: String(Math.floor(Date.parse(state.generatedAt) / 1000)),
            nanos: 0,
          },
        }),
      },
      runtime,
      store,
      events,
    );
    const port = await server.start();
    return {
      mode: "site_readonly" as const,
      profile,
      store,
      pool,
      archive,
      observer,
      driver,
      runtime,
      business,
      events,
      server,
      port,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
