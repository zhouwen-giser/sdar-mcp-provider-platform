import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  PostgresObservationArchive,
  safeCode,
  ZmqObservationObserver,
  ZmqSubscriptionDriver,
} from "../../../packages/vehicle-zmq-observer/src/index.js";
import { buildObservationApi } from "./api.js";
import { loadObservationConfig, observationPool } from "./config.js";

export async function runObservationServer() {
  const config = loadObservationConfig(),
    pool = observationPool(config);
  const archive = new PostgresObservationArchive(pool, config.scope, config.settings);
  const observer = new ZmqObservationObserver(
    config.profile,
    config.settings,
    config.scope,
    archive,
  );
  pool.on("error", () => observer.fail("ZMQ_ARCHIVE_CONNECTION_LOST"));
  const driver = new ZmqSubscriptionDriver(observer, config.settings),
    api = buildObservationApi(observer, archive);
  let finish: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stopDriver = observer.onFailure;
  observer.onFailure = () => {
    stopDriver?.();
    finish();
  };
  const onSignal = () => finish();
  let timer: ReturnType<typeof setTimeout> | undefined;
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await observer.start();
    await driver.start();
    const address = await api.listen({ host: config.settings.host, port: config.settings.port });
    console.log(
      JSON.stringify({
        event: "ready",
        readOnly: true,
        address,
        sessionId: observer.sessionId,
        partitionHash: config.scope.partitionHash,
        runtimeAdmission: "not_published",
      }),
    );
    if (config.durationMs !== null) timer = setTimeout(() => finish(), config.durationMs);
    await stopped;
  } finally {
    if (timer) clearTimeout(timer);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await driver.stop();
    try {
      await observer.stop();
    } finally {
      await api.close();
      await pool.end();
    }
    console.log(
      JSON.stringify({
        event: "stopped",
        sessionId: observer.sessionId,
        archive: observer.health,
        businessCommandsSent: 0,
      }),
    );
  }
  if (observer.health.status === "failed")
    throw Error(observer.health.failureCode ?? "ZMQ_OBSERVATION_FAILED");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runObservationServer().catch((error: unknown) => {
    console.error(JSON.stringify({ error: safeCode(error) }));
    process.exitCode = 1;
  });
}
