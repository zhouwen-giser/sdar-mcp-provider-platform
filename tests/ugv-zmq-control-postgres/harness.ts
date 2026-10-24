import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { PostgresProviderStore } from "../../packages/provider-adapter-kit/src/postgres-store.js";
import {
  ZmqObservationObserver,
  PostgresObservationArchive,
  ZmqSubscriptionDriver,
  observerIdentity,
  canonical,
  sha256,
} from "../../packages/vehicle-zmq-observer/src/index.js";
import {
  ZmqControlEngine,
  NativeControlTransport,
  PostgresControlRepository,
  controlScope,
  type ControlRepository,
  type CommandTransport,
} from "../../packages/vehicle-zmq-control/src/index.js";
import type { DeploymentProfile } from "../../packages/vehicle-zmq-contract/src/index.js";
import { settings } from "../ugv-zmq-observer/helpers.js";
import { camera, navigation, testScope } from "../ugv-zmq-control/helpers.js";

export async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10000,
): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await predicate()) return;
    await delay(10);
  }
  throw Error("SIMULATED_WAIT_TIMEOUT");
}
export function providerStore(databaseUrl: string, schema: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error("SIMULATED_SCHEMA_INVALID");
  const store = new PostgresProviderStore(databaseUrl, 4);
  store.pool.options.options = "-c search_path=" + schema;
  store.pool.options.query_timeout = 500;
  store.pool.options.statement_timeout = 500;
  store.pool.options.connectionTimeoutMillis = 1000;
  return store;
}
export async function boot(
  databaseUrl: string,
  schema: string,
  profile: DeploymentProfile,
  partition = "SIMULATED-control:" + randomUUID(),
  wrappers?: {
    repository?: (r: PostgresControlRepository) => ControlRepository;
    transport?: (t: NativeControlTransport) => CommandTransport;
  },
) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 6,
    connectionTimeoutMillis: 1000,
    query_timeout: 1000,
    statement_timeout: 1000,
  });
  const identity = observerIdentity(profile, partition, sha256(canonical(profile)), "c".repeat(64));
  const s = settings({
    schema,
    diagnosticPartition: partition,
    flushIntervalMs: 5,
    maxBatchRecords: 64,
    databaseTimeoutMs: 1000,
  });
  const archive = new PostgresObservationArchive(pool, identity, s),
    observer = new ZmqObservationObserver(profile, s, identity, archive);
  await observer.start();
  const driver = new ZmqSubscriptionDriver(observer, s);
  const scope = controlScope(profile, {
    ...testScope().settings,
    observerPartitionHash: identity.partitionHash,
    observerSessionId: observer.sessionId,
  });
  const store = providerStore(databaseUrl, schema);
  store.pool.options.query_timeout = 500;
  store.pool.options.statement_timeout = 500;
  store.pool.options.connectionTimeoutMillis = 1000;
  await store.initialize();
  const repository = new PostgresControlRepository(store, store.pool, scope),
    native = new NativeControlTransport(scope);
  const engine = new ZmqControlEngine(
    scope,
    wrappers?.repository?.(repository) ?? repository,
    wrappers?.transport?.(native) ?? native,
  );
  try {
    await driver.start();
    await engine.initialize(observer);
    engine.run();
  } catch (error) {
    await engine.close();
    await driver.stop();
    await observer.stop();
    await store.close();
    await pool.end();
    throw error;
  }
  const close = async () => {
    await engine.close();
    await driver.stop();
    await observer.stop();
    await store.close();
    await pool.end();
  };
  return {
    engine,
    observer,
    driver,
    archive,
    repository,
    scope,
    store,
    pool,
    partition,
    close,
    ready: () =>
      until(
        () => engine.availability(camera).available && engine.availability(navigation).available,
      ),
  };
}
