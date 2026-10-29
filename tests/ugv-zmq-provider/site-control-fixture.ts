import { OPERATION_ADMISSION_KEYS } from "../../packages/vehicle-zmq-control/src/operation-support.js";
import type { ViewBackendSettings } from "../../packages/vehicle-zmq-control/src/simulation-view-contract.js";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { Pool } from "pg";
import { WebSocketServer } from "ws";
import { openZmqProvider } from "../../apps/ugv-zmq-provider-adapter/src/bootstrap.js";
import { SiteControlDeploymentProfile } from "../../packages/vehicle-zmq-contract/src/site-profile.js";
import { canonical, sha256 } from "../../packages/vehicle-zmq-observer/src/index.js";
import { createHmac } from "node:crypto";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import { createRuntime } from "../../apps/runtime/src/runtime.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { installObservationArchive } from "../../packages/vehicle-zmq-observer/src/index.js";
import { Mcp } from "../../apps/ugv-control-console/server/mcp.js";
import { settings } from "../ugv-zmq-observer/helpers.js";
import { present, testScope } from "../ugv-zmq-control/helpers.js";
import {
  SimulatedZmqDevices,
  releaseSimulatorEndpoints,
} from "../ugv-zmq-control-postgres/simulator.js";

export const siteStart = { longitude: 106.81485 - 340 / 111320, latitude: 29.7195 - 100 / 110540 };
export const siteDestination = {
  longitude: 106.81485 - 192 / 111320,
  latitude: 29.7195 - 100 / 110540,
};
export async function controlSiteFixture(
  databaseUrl: string,
  authMode: "jwt_hs256" | "site_anonymous" = "jwt_hs256",
  catalogProfile?: "zmq_v1_3_0_site_control_13" | "zmq_v1_4_0_site_control_14",
  simulationView?: ViewBackendSettings,
) {
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
  const devices = new SimulatedZmqDevices();
  devices.controllerSystemId = "0";
  const original = await devices.start();
  const profile = SiteControlDeploymentProfile.parse({
    ...original,
    schemaVersion: "ugv.zmq-site-deployment/1",
    executionDomain: { mode: "live", simulationId: null },
    components: {
      ...original.components,
      chassis: { ...original.components.chassis, controllerSystemId: "0" },
    },
  });
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
  const grant = {
    schemaVersion: "ugv.zmq-site-handoff-grant/1",
    commandId: randomUUID(),
    planHash: "a".repeat(64),
    profileHash: sha256(canonical(profile)),
    providerId: profile.providerBinding.providerId,
    resourceId: profile.providerBinding.resourceId,
    actor: "SIMULATED-operator",
    reason: "isolated test grant; not field acceptance",
    createdAt: new Date().toISOString(),
    oldWriters: [
      { id: "e".repeat(64), image: "SIMULATED-old-image", running: false, restartPolicy: "no" },
    ],
    retiredTasks: [],
    outcome: "legacy_outcome_unknown_writers_stopped",
  };
  const seed = new Pool({ connectionString: db(0), max: 1 });
  await seed.query(
    "INSERT INTO ugv_state_snapshot(revision,observed_at,snapshot) VALUES($1,$2,$3)",
    ["site-handoff:" + grant.commandId, grant.createdAt, grant],
  );
  await seed.end();
  const providerOptions = {
    mode: "site_control" as const,
    handoffGrant: grant,
    controlSettings: {
      ...(simulationView ? { simulationView } : {}),
      ...testScope().settings,
      ...(catalogProfile
        ? {
            catalogProfile,
            maxSpeedMps: 30,
            transportSendTimeoutMs: 1000,
            transportReceiveTimeoutMs: 2000,
            databaseTimeoutMs: 2000,
          }
        : {}),
      operationSupport: Object.fromEntries(
        OPERATION_ADMISSION_KEYS.map((key) => [
          key,
          {
            status: "supported",
            description: "Isolated loopback site-contract fixture; not field qualification.",
            evidenceRef: "tests/ugv-zmq-control-postgres/simulator.ts",
          },
        ]),
      ),
      mode: "site_control",
      handoffGrantHash: sha256(canonical(grant)),
      siteEndpoints: Object.values(profile.components).flatMap((c) => [
        c.commandEndpoint,
        c.publicationEndpoint,
      ]),
    },
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
  let provider = await openZmqProvider(providerOptions);
  const jwtSecret = "SIMULATED-site-control-secret-at-least-32-bytes";
  const segment = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const signed =
    segment({ alg: "HS256", typ: "JWT" }) +
    "." +
    segment({
      sub: authMode === "site_anonymous" ? "development-anonymous" : "SIMULATED-operator",
      tenant: authMode === "site_anonymous" ? "default" : "SIMULATED-site",
      actor_type: "operator",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  const jwt = signed + "." + createHmac("sha256", jwtSecret).update(signed).digest("base64url");
  const runtime = createRuntime(
    loadRuntimeConfig({
      RUNTIME_ENV: "test",
      PROVIDER_ID: present(profile.providerBinding.providerId),
      DATABASE_URL: db(1),
      ADAPTER_ENDPOINT: `127.0.0.1:${provider.port}`,
      ADAPTER_TLS_MODE: "disabled",
      AUTH_MODE: authMode,
      ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
      JWT_HS256_SECRET: jwtSecret,
      LOG_LEVEL: "fatal",
      SCHEDULER_POLL_MS: "100",
      RECOVERY_POLL_MS: "500",
      BUSINESS_EVENTS_POLL_INTERVAL_MS: "100",
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
  const mcp = new Mcp(`http://127.0.0.1:${address.port}/mcp`, {
    "x-sdar-execution-mode": "live",
    authorization: "Bearer " + jwt,
  });
  return {
    admin,
    schemas,
    profile,
    resourceId: present(profile.providerBinding.resourceId),
    devices,
    plannerState,
    providerOptions,
    jwtSecret,
    jwt,
    mcp,
    runtime,
    get provider() {
      return provider;
    },
    async restartProvider() {
      const port = provider.port;
      await provider.close();
      provider = await openZmqProvider({ ...providerOptions, port });
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
