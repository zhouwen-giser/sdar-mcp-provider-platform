import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installObservationArchive } from "../../../packages/vehicle-zmq-observer/src/index.js";
import { loadObservationConfig, observationPool } from "./config.js";

export async function migrateObserver() {
  const config = loadObservationConfig(),
    pool = observationPool(config);
  try {
    await installObservationArchive(pool, config.settings.schema);
    console.log(JSON.stringify({ schema: config.settings.schema, installed: true }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await migrateObserver().catch(() => {
    console.error(JSON.stringify({ error: "ZMQ_OBSERVATION_OWNER_INSTALL_FAILED" }));
    process.exitCode = 1;
  });
}
