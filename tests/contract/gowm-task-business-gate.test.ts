import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  createGowmPool,
  verifyGowmTaskBusinessStorage,
  type GowmStorageConfig,
} from "../../packages/gowm-shared-storage-adapter/src/index.js";
import {
  BoundExecutionScope,
  PostgresTaskBusinessStore,
  assertGowmBusinessScope,
  storedTaskBusinessSourceId,
  taskBusinessSourceCapability,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";

const config: GowmStorageConfig = {
  mode: "gowm-shared",
  databaseUrl: "postgres://unused:unused@127.0.0.1:1/unused",
  serviceKey: "smpp-service-a",
  allowedDeviceIds: ["ugv1"],
  bindingId: "11111111-1111-4111-8111-111111111111",
  sourceSessionKey: "source-session-a",
  contractDir: "contracts/gowm-shared-storage/current",
};
const execution = (): ProviderExecution => ({
  taskId: "task-1",
  externalExecutionId: "execution-1",
  operationName: "vehicle_navigate",
  argumentHash: "a".repeat(64),
  providerId: "provider-1",
  resourceId: "vehicle:ugv1",
  tracks: [],
  arguments: {},
  executionContext: {
    authorizationContextHash: "b".repeat(64),
    executionMode: "SIMULATION",
    simulationId: "scene-a",
    correlationId: "correlation-a",
  },
  deviceContext: {
    deviceId: "ugv1",
    dataScopeKey: "scene-a",
    bindingId: config.bindingId,
    smppServiceKey: config.serviceKey,
    providerId: "provider-1",
    resourceId: "vehicle:ugv1",
    sourceSessionKey: config.sourceSessionKey,
  },
  downstreamMissionIds: [],
  state: "RUNNING",
  revision: 1,
  reasonCode: "TEST_FIXTURE",
  createdAt: "2026-09-23T00:00:00Z",
  updatedAt: "2026-09-23T00:00:00Z",
  evidence: [],
});

describe("GOWM task-business activation gate", () => {
  it("uses separate stored source keys and public streams for services and source sessions", () => {
    const service = { ...config, serviceKey: "smpp-service-b" };
    const session = { ...config, sourceSessionKey: "source-session-b" };
    expect(storedTaskBusinessSourceId(config)).not.toBe(storedTaskBusinessSourceId(service));
    expect(storedTaskBusinessSourceId(config)).not.toBe(storedTaskBusinessSourceId(session));
    expect(taskBusinessSourceCapability(config).sourceStreamId).not.toBe(
      taskBusinessSourceCapability(service).sourceStreamId,
    );
    expect(taskBusinessSourceCapability(config).sourceStreamId).not.toBe(
      taskBusinessSourceCapability(session).sourceStreamId,
    );
    expect(taskBusinessSourceCapability(config).sourceId).toBe("vehicle.business");
  });

  it("rejects a missing owner table before reading a manifest or opening a Store", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ rolsuper: false, rolbypassrls: false }] })
      .mockResolvedValueOnce({ rows: [{ usable: true }] })
      .mockResolvedValueOnce({ rows: [{ relation: null }] });
    const pool = { query } as unknown as Pool;
    await expect(verifyGowmTaskBusinessStorage(pool, config)).rejects.toThrow(
      "GOWM_BUSINESS_SCHEMA_NOT_INSTALLED",
    );
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("does not select the native Store on a scoped pool and rejects another service/device/session", async () => {
    const pool = createGowmPool(config, 1);
    try {
      expect(() => new PostgresTaskBusinessStore(pool)).toThrow(
        "GOWM_BUSINESS_STORE_VERIFICATION_REQUIRED",
      );
      expect(() => new PostgresTaskBusinessStore(pool, config)).toThrow(
        "GOWM_BUSINESS_POOL_MISMATCH",
      );
      const base = execution();
      const device = base.deviceContext;
      if (!device) throw new Error("CATALOG_DEVICE_CONTEXT_MISSING");
      for (const changed of [
        { ...device, deviceId: "ugv2" },
        { ...device, smppServiceKey: "other-service" },
        { ...device, sourceSessionKey: "other-session" },
      ]) {
        const scope = BoundExecutionScope.fromExecution({ ...base, deviceContext: changed });
        expect(() => assertGowmBusinessScope(scope, config)).toThrow(
          "GOWM_BUSINESS_SCOPE_MISMATCH",
        );
      }
    } finally {
      await pool.end();
    }
  });
});
