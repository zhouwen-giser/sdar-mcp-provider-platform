import { readFileSync, statSync } from "node:fs";
import { openSiteManagement } from "./site-management.js";
import { verifySiteGrant } from "../../../packages/vehicle-zmq-control/src/site-handoff.js";
import { SiteReadonlyRuntime } from "./site-runtime.js";
import { SiteRoutePlanner } from "./site-planner.js";
import { siteReadonlyBusiness } from "./business.js";
import { Pool } from "pg";
import { z } from "zod";
import { ControlDeploymentProfile } from "../../../packages/vehicle-zmq-contract/src/site-profile.js";
import {
  observerIdentity,
  ObserverSettings,
  PostgresObservationArchive,
  ZmqObservationObserver,
  ZmqSubscriptionDriver,
  canonical,
  sha256,
} from "../../../packages/vehicle-zmq-observer/src/index.js";
import {
  ControlSettings,
  controlScope,
  NativeControlTransport,
  PostgresControlRepository,
  ZmqControlEngine,
} from "../../../packages/vehicle-zmq-control/src/index.js";
import {
  PostgresProviderStore,
  PostgresTaskBusinessStore,
  openGowmTaskBusinessStore,
  verifyNativeTaskBusinessSchema,
} from "../../../packages/provider-adapter-kit/src/index.js";
import type { GowmStorageConfig } from "../../../packages/gowm-shared-storage-adapter/src/index.js";
import { ZmqBusinessEvents, zmqBusiness } from "./business.js";
import { ZmqProviderRuntime } from "./runtime.js";
import { zmqServer } from "./server.js";

export interface ZmqProviderOptions {
  mode?: "site_control";
  management?: { port: number; jwtSecretFile: string };
  handoffGrant?: unknown;
  plannerFrame?: "airport_south_positive_v1";
  databaseUrl: string;
  /** Independent SMPP-owned archive; schema installation is an owner command, never startup DDL. */
  observationDatabaseUrl: string;
  profile: unknown;
  observerSettings: unknown;
  controlSettings: unknown;
  gowm?: GowmStorageConfig;
  host?: string;
  port?: number;
}
export async function openZmqProvider(options: ZmqProviderOptions) {
  const profile = ControlDeploymentProfile.parse(options.profile),
    settings = ObserverSettings.parse(options.observerSettings);
  // Validate all command endpoints before creating a socket, pool or attempting admission.
  const limits = ControlSettings.parse(options.controlSettings);
  if (options.gowm)
    limits.storageBinding = {
      deviceId: options.gowm.allowedDeviceIds[0] ?? "",
      bindingId: options.gowm.bindingId,
      serviceKey: options.gowm.serviceKey,
      sourceSessionKey: options.gowm.sourceSessionKey,
    };
  if ((options.mode === "site_control") !== (limits.mode === "site_control"))
    throw Error("ZMQ_CONTROL_MODE_MISMATCH");
  controlScope(profile, limits);
  if (options.observationDatabaseUrl === options.gowm?.databaseUrl)
    throw Error("ZMQ_OBSERVATION_OWNER_DATABASE_REQUIRED");
  if ((options.host ?? "127.0.0.1") !== "127.0.0.1")
    throw Error("ZMQ_ISOLATED_GRPC_LOOPBACK_REQUIRED");
  z.url().parse(options.databaseUrl);
  z.url().parse(options.observationDatabaseUrl);
  const store = new PostgresProviderStore(options.databaseUrl, 8, "ugv", options.gowm);
  store.pool.options.query_timeout = limits.databaseTimeoutMs;
  store.pool.options.statement_timeout = limits.databaseTimeoutMs;
  store.pool.options.connectionTimeoutMillis = limits.databaseTimeoutMs;
  const pool = new Pool({
    connectionString: options.observationDatabaseUrl,
    max: 6,
    connectionTimeoutMillis: settings.databaseTimeoutMs,
    query_timeout: settings.databaseTimeoutMs,
    statement_timeout: settings.databaseTimeoutMs,
  });
  const identity = observerIdentity(
    profile,
    settings.diagnosticPartition,
    sha256(canonical(profile)),
    limits.contractSha256,
  );
  const archive = new PostgresObservationArchive(pool, identity, settings),
    observer = new ZmqObservationObserver(profile, settings, identity, archive),
    driver = new ZmqSubscriptionDriver(observer, settings);
  let management: Awaited<ReturnType<typeof openSiteManagement>> | undefined;
  let engine: ZmqControlEngine | undefined,
    server: ReturnType<typeof zmqServer> | undefined,
    closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await management?.close();
    await server?.close();
    await engine?.close();
    await driver.stop();
    await observer.stop();
    await store.close();
    await pool.end();
  };
  try {
    await store.initialize();
    if (options.mode === "site_control") {
      const grant = await verifySiteGrant(store, profile, options.handoffGrant);
      if (sha256(canonical(grant)) !== limits.handoffGrantHash)
        throw Error("ZMQ_SITE_GRANT_HASH_MISMATCH");
    }
    const businessStore = options.gowm
      ? await openGowmTaskBusinessStore(store.pool, options.gowm)
      : new PostgresTaskBusinessStore(store.pool);
    if (!options.gowm) await verifyNativeTaskBusinessSchema(store.pool);
    store.enableTaskBusinessSource(businessStore);
    await observer.start();
    const scope = controlScope(profile, {
      ...limits,
      observerSessionId: observer.sessionId,
      observerPartitionHash: identity.partitionHash,
    });
    const repository = new PostgresControlRepository(store, store.pool, scope),
      events = new ZmqBusinessEvents(store),
      business = zmqBusiness(
        store,
        businessStore,
        profile.providerBinding.providerId ?? "",
        profile.providerBinding.resourceId ?? "",
        events,
      );
    engine = new ZmqControlEngine(
      scope,
      repository,
      new NativeControlTransport(scope),
      undefined,
      business,
    );
    const siteReads =
      options.mode === "site_control"
        ? new SiteReadonlyRuntime(
            profile,
            observer,
            store,
            siteReadonlyBusiness(
              store,
              businessStore,
              profile.providerBinding.providerId ?? "",
              profile.providerBinding.resourceId ?? "",
            ),
            profile.planner.policy === "retain" && profile.planner.endpoint && options.plannerFrame
              ? new SiteRoutePlanner(profile.planner.endpoint, pool)
              : undefined,
          )
        : undefined;
    const runtime = new ZmqProviderRuntime(engine, observer, business, siteReads);
    if (options.mode === "site_control" && options.management) {
      if (statSync(options.management.jwtSecretFile).mode & 0o077)
        throw Error("ZMQ_PRIVATE_JWT_FILE_REQUIRED");
      management = await openSiteManagement(
        engine,
        readFileSync(options.management.jwtSecretFile, "utf8").trim(),
        options.management.port,
      );
    }
    server = zmqServer(runtime, store, events, options.port ?? 0, options.host ?? "127.0.0.1");
    const port = await server.start();
    await engine.initialize(observer);
    await driver.start();
    engine.run();
    return {
      mode: options.mode ?? "isolated_simulator_only",
      store,
      pool,
      archive,
      observer,
      driver,
      scope,
      repository,
      engine,
      runtime,
      events,
      business,
      server,
      port,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
