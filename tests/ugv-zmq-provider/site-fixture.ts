import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { Pool } from "pg";
import { WebSocketServer } from "ws";
import { openSiteReadonlyProvider } from "../../apps/ugv-zmq-provider-adapter/src/site-bootstrap.js";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import { createRuntime } from "../../apps/runtime/src/runtime.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { installObservationArchive } from "../../packages/vehicle-zmq-observer/src/index.js";
import { Mcp } from "../../apps/ugv-control-console/server/mcp.js";
import { settings } from "../ugv-zmq-observer/helpers.js";
import { present } from "../ugv-zmq-control/helpers.js";
import {
  SimulatedZmqDevices,
  releaseSimulatorEndpoints,
} from "../ugv-zmq-control-postgres/simulator.js";

export const siteStart = { longitude: 106.81485 - 340 / 111320, latitude: 29.7195 - 100 / 110540 };
export const siteDestination = {
  longitude: 106.81485 - 192 / 111320,
  latitude: 29.7195 - 100 / 110540,
};
export async function siteFixture(databaseUrl: string) {
  if (new URL(databaseUrl).hostname !== "127.0.0.1") throw Error("ISOLATED_DATABASE_REQUIRED");
  const suffix = randomUUID().replaceAll("-", ""),
    schemas = ["site_provider_", "site_runtime_", "site_archive_"].map((s) => s + suffix);
  const admin = new Pool({ connectionString: databaseUrl, max: 2 });
  const db = (index: number) => {
    const u = new URL(databaseUrl);
    u.searchParams.set("options", "-c search_path=" + present(schemas[index]));
    return u.toString();
  };
  for (const schema of schemas) await admin.query(`CREATE SCHEMA ${schema}`);
  const installer = new Pool({ connectionString: db(0), max: 1 });
  try {
    await runUgvProviderMigrations(installer, fileURLToPath(new URL("../../", import.meta.url)));
  } finally {
    await installer.end();
  }
  await installObservationArchive(admin, present(schemas[2]));
  const devices = new SimulatedZmqDevices(),
    profile = await devices.start();
  profile.executionDomain.simulationId = null;
  profile.components.chassis.controllerSystemId = null;
  const planner = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(planner, "listening");
  const plannerAddress = planner.address();
  if (!plannerAddress || typeof plannerAddress === "string")
    throw Error("FIXTURE_PLANNER_ADDRESS_REQUIRED");
  profile.planner = { policy: "retain", endpoint: `http://127.0.0.1:${plannerAddress.port}` };
  const plannerState = { calls: 0, delayMs: 0, mismatch: false, messages: [] as string[] };
  planner.on("connection", (socket) => {
    socket.send("0{}");
    socket.on("message", (data) => {
      const value = (
        Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
      ).toString("utf8");
      plannerState.messages.push(value);
      if (value === "40") socket.send("40{}");
      else if (value.startsWith("42")) {
        const packet = JSON.parse(value.slice(2)) as [string, { points: [number, number][] }];
        if (packet[0] !== "plan_route") return;
        plannerState.calls++;
        const points = [plannerState.mismatch ? [9999, 9999] : [-340, 100], ...packet[1].points];
        setTimeout(() => {
          if (socket.readyState === 1)
            socket.send(
              "42" +
                JSON.stringify([
                  "route_candidates",
                  {
                    target: "ugv",
                    ok: true,
                    candidates: [
                      {
                        id: "controlled-site-preview",
                        points,
                        num_points: points.length,
                        length_m: 148,
                      },
                    ],
                  },
                ]),
            );
        }, plannerState.delayMs);
      }
    });
  });
  const providerOptions = {
    mode: "site_readonly" as const,
    databaseUrl: db(0),
    observationDatabaseUrl: databaseUrl,
    profile,
    observerSettings: settings({
      schema: present(schemas[2]),
      diagnosticPartition: "SIMULATED-site:" + suffix,
      flushIntervalMs: 5,
    }),
    contractSha256: "b".repeat(64),
    plannerFrame: "airport_south_positive_v1" as const,
  };
  let provider = await openSiteReadonlyProvider(providerOptions);
  const runtime = createRuntime(
    loadRuntimeConfig({
      RUNTIME_ENV: "test",
      PROVIDER_ID: present(profile.providerBinding.providerId),
      DATABASE_URL: db(1),
      ADAPTER_ENDPOINT: `127.0.0.1:${provider.port}`,
      ADAPTER_TLS_MODE: "disabled",
      AUTH_MODE: "development",
      LOG_LEVEL: "fatal",
      OTEL_ENABLED: "false",
      PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
      BUSINESS_EVENTS_ENABLED: "true",
      RATE_LIMIT_MAX: "100000",
    }),
  );
  await runtime.initialize();
  await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const address = runtime.app.server.address();
  if (!address || typeof address === "string") throw Error("FIXTURE_HTTP_ADDRESS_REQUIRED");
  const mcp = new Mcp(`http://127.0.0.1:${address.port}/mcp`, { "x-sdar-execution-mode": "live" });
  return {
    admin,
    schemas,
    profile,
    resourceId: present(profile.providerBinding.resourceId),
    devices,
    plannerState,
    mcp,
    runtime,
    get provider() {
      return provider;
    },
    async restartProvider() {
      const port = provider.port;
      await provider.close();
      provider = await openSiteReadonlyProvider({ ...providerOptions, port });
    },
    async close() {
      await runtime.app.close();
      await provider.close();
      await devices.close();
      releaseSimulatorEndpoints();
      for (const socket of planner.clients) socket.terminate();
      await new Promise<void>((resolve, reject) =>
        planner.close((error) => (error ? reject(error) : resolve())),
      );
      for (const schema of schemas.reverse())
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    },
  };
}
