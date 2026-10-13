import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { connect, type MqttClient } from "mqtt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { createRuntime, type RuntimeApplication } from "../../apps/runtime/src/runtime.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvProviderServer } from "../../apps/ugv-provider-adapter/src/server.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import { NavigationTrajectoryProcessor } from "../../apps/ugv-provider-adapter/src/navigation-trajectory-processor.js";
import {
  PostgresProviderStore,
  PostgresTaskBusinessStore,
  BoundExecutionScope,
} from "../../packages/provider-adapter-kit/src/index.js";
import { runMigrations } from "../../packages/persistence-postgres/src/index.js";
import {
  VehicleMqttIngress,
  UgvMqttClient,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { PostgresReceptionStore } from "../../packages/trajectory-history/src/postgres-store.js";
import { TrajectoryReceptionJournal } from "../../packages/trajectory-history/src/journal.js";
import { TrajectoryHistoryReader } from "../../packages/trajectory-history/src/reader.js";
import { HistoryPageSchema } from "../../packages/trajectory-history/src/contract.js";
import {
  RetainedHistoryVerifier,
  historySha256,
} from "../../packages/trajectory-history/src/proof.js";
import { verifyProjectionEvidence } from "../../packages/trajectory-history/src/projection.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";

const configurationFile = process.env.SMPP_TRAJECTORY_TEST_CONFIG_FILE;
const providerId = "isr.vehicle.ugv.history-public-simulated";
const suffix = randomUUID().replaceAll("-", "");
const providerSchema = "history_public_provider_" + suffix;
const runtimeSchema = "history_public_runtime_" + suffix;
const keys = generateKeyPairSync("ed25519");
let admin: Pool, provider: PostgresProviderStore, business: PostgresTaskBusinessStore;
let history: PostgresReceptionStore, reader: TrajectoryHistoryReader, ingress: VehicleMqttIngress;
let mqtt: UgvMqttClient,
  publisher: MqttClient,
  adapter: UgvProviderRuntime,
  server: UgvProviderServer;
let runtime: RuntimeApplication, url: string;

async function until(predicate: () => Promise<boolean> | boolean) {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error("ISOLATED_HISTORY_WAIT_TIMEOUT");
}
async function publish(topic: string, value: unknown, retained = false) {
  const bytes = Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
  await new Promise<void>((resolve, reject) =>
    publisher.publish(topic, bytes, { qos: 1, retain: retained }, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  return bytes;
}
async function request(
  method: string,
  params: Record<string, unknown>,
  subject = "history-test-reader",
) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(typeof params.name === "string"
        ? { "mcp-name": params.name }
        : typeof params.taskId === "string"
          ? { "mcp-name": params.taskId }
          : {}),
      "x-sdar-subject": subject,
      "x-sdar-tenant": "history-test-tenant",
      "x-sdar-execution-mode": "simulation",
      "x-sdar-simulation-id": "ISOLATED-SIMULATED-HISTORY",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "SIMULATED-history-acceptance",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: {
              "io.modelcontextprotocol/tasks": {},
              "io.sdar/taskBusiness": { profileVersion: "1.0-rc2" },
            },
          },
        },
      },
    }),
  });
  const body = (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
  return { status: response.status, ...body };
}
async function read(argumentsValue: Record<string, unknown> = {}, subject?: string) {
  const response = await request(
    "tools/call",
    {
      name: "vehicle_get_trajectory_history",
      arguments: { resourceId: "vehicle:ugv1", historyVersion: "1.0", ...argumentsValue },
    },
    subject,
  );
  expect(response.status, JSON.stringify(response)).toBe(200);
  expect(response.error, JSON.stringify(response)).toBeUndefined();
  expect(response.result?.isError, JSON.stringify(response)).not.toBe(true);
  return HistoryPageSchema.parse(response.result?.structuredContent);
}

describe.skipIf(!configurationFile)(
  "SIMULATED public MCP / gRPC / MQTT / real isolated PostgreSQL trajectory history",
  () => {
    beforeAll(async () => {
      if (!configurationFile) throw Error("ISOLATED_HISTORY_CONFIG_REQUIRED");
      const config = JSON.parse(readFileSync(configurationFile, "utf8")) as {
        databaseUrl: string;
        brokerUrl: string;
      };
      if (
        !config.brokerUrl?.startsWith("mqtt://127.0.0.1:") ||
        !new URL(config.databaseUrl).pathname.includes("test")
      )
        throw Error("ISOLATED_HISTORY_INFRASTRUCTURE_REQUIRED");
      admin = new Pool({ connectionString: config.databaseUrl });
      await admin.query(`CREATE SCHEMA ${providerSchema}; CREATE SCHEMA ${runtimeSchema}`);
      const providerUrl = new URL(config.databaseUrl);
      providerUrl.searchParams.set("options", "-c search_path=" + providerSchema);
      const runtimeUrl = new URL(config.databaseUrl);
      runtimeUrl.searchParams.set("options", "-c search_path=" + runtimeSchema);
      provider = new PostgresProviderStore(providerUrl.toString(), 8);
      await runUgvProviderMigrations(provider.pool);
      business = new PostgresTaskBusinessStore(provider.pool);
      provider.enableTaskBusinessSource(business);
      ingress = new VehicleMqttIngress("direct_domain_json", {
        maxPayloadBytes: 65536,
        maxDepth: 16,
        maxNodes: 4096,
        maxStringBytes: 16384,
      });
      history = new PostgresReceptionStore(provider.pool, {
        providerId,
        resourceId: "vehicle:ugv1",
        deviceId: "ugv1",
        deviceIdentityAuthority: "PROVIDER_RESOURCE_CONFIGURATION",
        sourceSessionKey: "SIMULATED-public-mqtt",
      });
      const journal = new TrajectoryReceptionJournal(history, ingress, "SIMULATED");
      await journal.initialize();
      reader = new TrajectoryHistoryReader(history, keys.privateKey, "SIMULATED");
      const hub = new UgvBusinessEventHub(provider);
      const service = new UgvTaskBusinessContextService(
        provider,
        business,
        providerId,
        "vehicle:ugv1",
        (event) => hub.notifyCommittedTaskBusinessEvent(event),
      );
      adapter = new UgvProviderRuntime(
        {
          providerId,
          resourceId: "vehicle:ugv1",
          executionMode: "simulation",
          fireEnabled: false,
          fireRequiresChassisStopped: true,
          freshness: { chassis: 3000, mission: 3000, health: 5000, target: 3000, payload: 3000 },
          allowNavigationWithRecon: true,
          pollIntervalMs: 60000,
          trajectorySampleEveryMs: 0,
          trajectoryHistory: reader,
        },
        provider,
        ingress,
        new MockUgvDeviceMcpClient(),
        hub,
        new UgvTelemetry({
          providerId,
          enabled: false,
          endpoint: "127.0.0.1:7002",
          tlsMode: "disabled",
        }),
        service,
      );
      await adapter.initializeLocal();
      server = new UgvProviderServer(
        {
          providerId,
          providerVersion: "trajectory-history-v1-test",
          host: "127.0.0.1",
          port: 0,
          tlsMode: "disabled",
        },
        adapter,
        provider,
        hub,
      );
      const port = await server.start();
      const runtimePool = new Pool({ connectionString: runtimeUrl.toString() });
      await runMigrations(runtimePool);
      await runtimePool.end();
      runtime = createRuntime(
        loadRuntimeConfig({
          RUNTIME_ENV: "test",
          PROVIDER_ID: providerId,
          DATABASE_URL: runtimeUrl.toString(),
          ADAPTER_ENDPOINT: "127.0.0.1:" + String(port),
          ADAPTER_TLS_MODE: "disabled",
          AUTH_MODE: "trusted_headers",
          LOG_LEVEL: "error",
          OTEL_ENABLED: "false",
          PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
          BUSINESS_EVENTS_ENABLED: "true",
          SCHEDULER_POLL_MS: "60000",
        }),
      );
      await runtime.initialize();
      await runtime.app.listen({ host: "127.0.0.1", port: 0 });
      const address = runtime.app.server.address();
      if (!address || typeof address === "string") throw Error("HISTORY_TEST_HTTP_BIND_FAILED");
      url = "http://127.0.0.1:" + String(address.port) + "/mcp";
      mqtt = new UgvMqttClient(
        {
          url: config.brokerUrl,
          clientId: "history-test-" + suffix,
          tlsMode: "disabled",
          sessionMode: "clean",
          reconnectMinMs: 100,
          reconnectMaxMs: 1000,
          receptionJournal: journal,
        },
        ingress,
      );
      mqtt.start();
      publisher = connect(config.brokerUrl, {
        clientId: "history-publisher-" + suffix,
        reconnectPeriod: 0,
      });
      await new Promise<void>((resolve, reject) => {
        publisher.once("connect", () => resolve());
        publisher.once("error", reject);
      });
      // Use a retained fixture so subscribing after publication cannot miss startup qualification.
      await publish(
        "status/ugv",
        {
          vehicle_id: "ugv1",
          role_name: "ugv",
          speed_kmh: 0,
          chassis_task: { state: -1, progress: 0 },
          eo_task: { state: -1, progress: 0 },
          weapon_task: { state: -1, progress: 0 },
          available: true,
        },
        true,
      );
      await until(() => ingress.snapshot().connectivity.mqttConnected);
      await adapter.initializeDependencies();
    }, 30000);
    afterAll(async () => {
      if (publisher) {
        await new Promise<void>((resolve) =>
          publisher.publish("status/ugv", "", { retain: true }, () => resolve()),
        );
        await publisher.endAsync();
      }
      await mqtt?.stop();
      await runtime?.app.close();
      await history?.releaseWriterLease();
      await server?.close();
      await adapter?.close();
      if (admin) {
        await admin.query(
          `DROP SCHEMA IF EXISTS ${providerSchema} CASCADE; DROP SCHEMA IF EXISTS ${runtimeSchema} CASCADE`,
        );
        await admin.end();
      }
    }, 30000);

    it("discovers versioned read schemas, roundtrips signatures and observes actual reception time", async () => {
      const tools = await request("tools/list", {});
      const list = tools.result?.tools as {
        name: string;
        inputSchema: { properties: { historyVersion?: { const?: string } } };
      }[];
      expect(
        list.find((tool) => tool.name === "vehicle_get_trajectory_history")?.inputSchema.properties
          .historyVersion?.const,
      ).toBe("1.0");
      expect(list.some((tool) => tool.name === "vehicle_get_trajectory_evidence")).toBe(true);
      const before = Date.now();
      const bytes = await publish("/ugv/gnss", {
        entity_id: "ugv1",
        longitude: 114.1,
        latitude: 30.1,
      });
      await until(async () => BigInt((await history.state()).highWatermark) >= 2n);
      const page = await read({ limit: 1 });
      const verifier = new RetainedHistoryVerifier(page.snapshot, keys.publicKey, history.scope);
      let next = page;
      const entries = [];
      for (;;) {
        for (const entry of next.entries) {
          verifier.accept(entry);
          entries.push(entry);
        }
        if (!next.nextCursor) break;
        next = await read({ pageCursor: next.nextCursor });
      }
      expect(verifier.finish(next.rangeReadFinished)).toEqual({
        retainedSetVerified: true,
        deviceHistoryComplete: false,
      });
      const point = entries.find(
        (entry) => entry.receipt.originalMessageSha256 === historySha256(bytes),
      );
      expect(point).toBeDefined();
      if (!point) throw Error("EXPECTED_MQTT_RECEIPT_MISSING");
      expect(Date.parse(point.receipt.providerReceivedAt.utc)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(point.receipt.providerReceivedAt.utc)).toBeLessThanOrEqual(Date.now());
      expect(point.receipt.reportedTime).toBeNull();
      expect(point.receipt.deviceAcquisitionTime).toBeNull();
      expect(page.snapshot.manifest.evidenceClass).toBe("SIMULATED");
      expect(page.snapshot.manifest.deviceGenerationHistory.status).toBe("unknown");
    });

    it("retains duplicates, late clocks, sequence jumps and foreign-device rejections before snapshot filtering", async () => {
      const start = BigInt((await history.state()).highWatermark) + 1n;
      const now = Math.floor(Date.now() / 1000) - 2;
      const body = {
        entity_id: "ugv1",
        longitude: 114.11,
        latitude: 30.1,
        header: { seq: 10, stamp: { sec: now, nanosec: 0 } },
      };
      await publish("/ugv/gnss", body);
      await publish("/ugv/gnss", body);
      await publish("/ugv/gnss", {
        ...body,
        header: { seq: 15, stamp: { sec: now + 1, nanosec: 0 } },
      });
      await publish("/ugv/gnss", {
        ...body,
        header: { seq: 9, stamp: { sec: now - 1, nanosec: 0 } },
      });
      await publish("/ugv/gnss", { ...body, entity_id: "other-device" });
      await until(async () => BigInt((await history.state()).highWatermark) >= start + 4n);
      const page = await read({
        fromSequence: start.toString(),
        throughSequence: (start + 4n).toString(),
      });
      expect(page.entries).toHaveLength(5);
      expect(page.entries[0]?.receipt.originalMessageSha256).toBe(
        page.entries[1]?.receipt.originalMessageSha256,
      );
      expect(new Set(page.entries.map((entry) => entry.receipt.receptionId)).size).toBe(5);
      expect(page.entries[2]?.receipt.diagnostics).toContain(
        "REPORTED_SEQUENCE_JUMP_WITHOUT_ATTESTED_EPOCH",
      );
      expect(page.entries[3]?.receipt.reportedTime?.quality).toBe("REPORTED_CLOCK_REGRESSION");
      expect(page.entries[4]?.receipt).toMatchObject({
        disposition: "REJECTED",
        position: null,
        reasonCode: "UGV_MQTT_ENTITY_MISMATCH",
      });
      expect(page.snapshot.manifest.retainedHistory.status).toBe("complete");
    });

    it("rejects cross-caller cursors and resource substitutions through the public MCP read path", async () => {
      const first = await read({ limit: 1 });
      const response = await request(
        "tools/call",
        {
          name: "vehicle_get_trajectory_history",
          arguments: {
            resourceId: "vehicle:ugv1",
            historyVersion: "1.0",
            pageCursor: first.nextCursor,
          },
        },
        "different-reader",
      );
      expect(response.error ?? response.result?.isError).toBeTruthy();
      const wrongResource = await request("tools/call", {
        name: "vehicle_get_trajectory_history",
        arguments: { resourceId: "vehicle:other", historyVersion: "1.0" },
      });
      expect(wrongResource.error ?? wrongResource.result?.isError).toBeTruthy();
    });

    it("publishes coordinate evidence with atomic receipt links, rejects forgery and preserves sampled geometry semantics", async () => {
      await publish("/ugv/gnss", { entity_id: "ugv1", longitude: 114.1, latitude: 30.1 });
      await publish("/ugv/component_status", {
        entity_id: "ugv1",
        power_battery: 0,
        lvbattery: 0,
        fuel: 0,
        water_temp: 0,
        motor: 0,
        sensor: 0,
        gnss: 0,
        comms: 0,
        weapon: 0,
        navigation: 0,
      });
      await publish("status/ugv", {
        vehicle_id: "ugv1",
        role_name: "ugv",
        speed_kmh: 0,
        chassis_task: { state: -1, progress: 0 },
        eo_task: { state: -1, progress: 0 },
        weapon_task: { state: -1, progress: 0 },
        available: true,
      });
      await until(() => ingress.snapshot().health.chassisErrorCodes.length === 0);
      const created = await request("tools/call", {
        name: "vehicle_navigate",
        arguments: {
          resourceId: "vehicle:ugv1",
          mission: { type: "point", target: { latitude: 30.2, longitude: 114.2 } },
          speedLimitKmh: 20,
          stopOnObstacle: true,
        },
      });
      expect(created.result?.resultType, JSON.stringify(created)).toBe("task");
      const taskId = String(created.result?.taskId);
      const execution = await provider.getExecution(taskId);
      if (!execution) throw Error("SIMULATED_NAVIGATION_EXECUTION_MISSING");
      const missionId = execution.downstreamMissionIds.at(-1);
      await publish("/ugv/mission_state", { id: Number(missionId), state: 1, progress: 10 });
      await until(() => ingress.snapshot().chassis.mission.id === missionId);
      await publish("/ugv/gnss", { entity_id: "ugv1", longitude: 114.12, latitude: 30.12 });
      const scope = BoundExecutionScope.fromExecution(execution);
      await until(
        async () => (await business.getContext(scope))?.activeRefs.trajectory !== undefined,
      );
      const context = await business.getContext(scope);
      const ref = context?.activeRefs.trajectory;
      if (!ref) throw Error("SIMULATED_TRAJECTORY_ARTIFACT_MISSING");
      const artifactResponse = await request("io.sdar/taskBusiness/artifacts/get", {
        taskId,
        artifactId: ref.id,
        revision: ref.revision,
      });
      expect(artifactResponse.error, JSON.stringify(artifactResponse)).toBeUndefined();
      const artifact = TaskArtifactSchema.parse(artifactResponse.result?.artifact);
      const args = {
        resourceId: "vehicle:ugv1",
        historyVersion: "1.0",
        taskId,
        executionId: execution.externalExecutionId,
        artifactId: ref.id,
        revision: ref.revision,
      };
      const evidenceResponse = await request("tools/call", {
        name: "vehicle_get_trajectory_evidence",
        arguments: args,
      });
      expect(evidenceResponse.result?.isError, JSON.stringify(evidenceResponse)).not.toBe(true);
      const evidence = verifyProjectionEvidence(
        evidenceResponse.result?.structuredContent,
        keys.publicKey,
        artifact,
      );
      expect(evidence.points[0]?.receptionTimeQuality).toBe("ENTRANCE_RECEIPT_LINKED");
      expect(evidence.points[0]?.reception?.scope.streamId).toBe(history.scope.streamId);
      expect(evidence.projectionPolicy).toBe("SAMPLED_GEOMETRY_NOT_FULL_RECEPTION_HISTORY");
      expect(evidence.missionBinding.deviceExecutionOwnership).toBe("NOT_ATTESTED");
      const forbidden = await request(
        "tools/call",
        { name: "vehicle_get_trajectory_evidence", arguments: args },
        "different-reader",
      );
      expect(forbidden.error ?? forbidden.result?.isError).toBeTruthy();
      const before = await business.getContext(scope);
      await expect(
        new NavigationTrajectoryProcessor(
          business,
          () => undefined,
          3000,
          0,
          true,
          history.scope.streamId,
        ).apply(execution, {
          schemaVersion: "ugv.navigation-position-fact/1",
          missionId,
          sourceCursor: "forged-reception-id",
          sourceTopic: "/ugv/gnss",
          observedAt: new Date(Date.now() + 1).toISOString(),
          position: { longitude: 114.13, latitude: 30.13 },
          receptionId: randomUUID(),
        }),
      ).rejects.toThrow("TRAJECTORY_EVIDENCE_RECEIPT_NOT_FOUND");
      expect(await business.getContext(scope)).toEqual(before);
    }, 30000);

    it("invalidates a previously sealed range after owner retention and verifies the remaining range", async () => {
      const first = await read({ limit: 1 });
      await provider.pool.query<Record<string, unknown>>(
        "SELECT ugv_trajectory_history_prune($1,1)",
        [history.identityHash],
      );
      const resume = await request("tools/call", {
        name: "vehicle_get_trajectory_history",
        arguments: {
          resourceId: "vehicle:ugv1",
          historyVersion: "1.0",
          pageCursor: first.nextCursor,
        },
      });
      expect(resume.error ?? resume.result?.isError).toBeTruthy();
      const missing = await read({ fromSequence: "1" });
      expect(missing.snapshot.manifest.retainedHistory.status).toBe("incomplete");
      expect(missing.snapshot.manifest.retainedHistory.reasons).toContain(
        "RETENTION_TRIMMED_RANGE",
      );
      const remaining = await read({ fromSequence: "2", limit: 256, maxPageBytes: 1048576 });
      const verifier = new RetainedHistoryVerifier(
        remaining.snapshot,
        keys.publicKey,
        history.scope,
      );
      for (const entry of remaining.entries) verifier.accept(entry);
      expect(verifier.finish(remaining.rangeReadFinished).retainedSetVerified).toBe(true);
    });
  },
);
