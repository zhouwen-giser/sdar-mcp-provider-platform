import { requireValue } from "../../packages/gowm-shared-storage-adapter/src/value.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  loadGowmStorageConfig,
  createGowmPool,
  resolveDeviceContext,
} from "../../packages/gowm-shared-storage-adapter/src/index.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { loadUgvProviderConfig } from "../../apps/ugv-provider-adapter/src/config.js";
import { runMigrations } from "../../packages/persistence-postgres/src/migrations.js";
const env = {
  SMPP_STORAGE_MODE: "gowm-shared",
  GOWM_DATABASE_URL: "postgresql://user:placeholder@localhost/test",
  SMPP_SERVICE_KEY: "service",
  SMPP_ALLOWED_DEVICE_IDS: '["device-A"]',
  SMPP_GOWM_BINDING_ID: "00000000-0000-4000-8000-000000000001",
  SMPP_SOURCE_SESSION_KEY: "observed-connection",
};
describe("shared storage deployment boundary", () => {
  it("keeps standalone default and rejects unknown modes", () => {
    expect(loadGowmStorageConfig({})).toBeUndefined();
    expect(() => loadGowmStorageConfig({ SMPP_STORAGE_MODE: "wrong" })).toThrow(
      "GOWM_STORAGE_MODE_INVALID",
    );
  });
  it("does not permit legacy database fallback or connection option injection", () => {
    expect(() => loadGowmStorageConfig({ ...env, DATABASE_URL: "postgresql://old/db" })).toThrow(
      "GOWM_SHARED_DATABASE_MISMATCH",
    );
    expect(() =>
      loadGowmStorageConfig({ ...env, UGV_ADAPTER_DATABASE_URL: "postgresql://old/db" }),
    ).toThrow("GOWM_SHARED_DATABASE_MISMATCH");
    expect(() =>
      loadGowmStorageConfig({
        ...env,
        GOWM_DATABASE_URL: env.GOWM_DATABASE_URL + "?options=-csearch_path=public",
      }),
    ).toThrow("GOWM_STORAGE_URL_OPTIONS_FORBIDDEN");
  });
  it.each(["[]", '["A","B"]', '["A","A"]', "A,B", '[""]'])(
    "rejects missing or ambiguous single-device scope %s",
    (ids) => {
      expect(() => loadGowmStorageConfig({ ...env, SMPP_ALLOWED_DEVICE_IDS: ids })).toThrow(
        "DEVICE_SCOPE_REQUIRED",
      );
    },
  );
  it("resolves the same explicit master database for Runtime and UGV factories", () => {
    const runtime = loadRuntimeConfig(env),
      provider = loadUgvProviderConfig(env);
    expect(runtime.DATABASE_URL).toBe(env.GOWM_DATABASE_URL);
    expect(provider.UGV_ADAPTER_DATABASE_URL).toBe(env.GOWM_DATABASE_URL);
    expect(provider.UGV_ADAPTER_STORE_MODE).toBe("postgres");
    expect(Object.isFrozen(runtime.gowmStorage?.allowedDeviceIds)).toBe(true);
  });
  it("loads a supplied database secret file and refuses a conflicting old file", () => {
    const dir = mkdtempSync(join(tmpdir(), "smpp-gowm-config-"));
    try {
      const file = join(dir, "url");
      writeFileSync(file, env.GOWM_DATABASE_URL);
      expect(
        loadGowmStorageConfig({
          ...env,
          GOWM_DATABASE_URL: undefined,
          GOWM_DATABASE_URL_FILE: file,
        })?.databaseUrl,
      ).toBe(env.GOWM_DATABASE_URL);
      writeFileSync(file, "postgresql://wrong/db");
      expect(() => loadGowmStorageConfig({ ...env, DATABASE_URL_FILE: file })).toThrow(
        "GOWM_SHARED_DATABASE_MISMATCH",
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it("rejects unavailable and wrong-device bindings before dispatch", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(
      resolveDeviceContext({ query } as never, requireValue(loadGowmStorageConfig(env)), {
        providerId: "ugv",
        resourceId: "resource",
      }),
    ).rejects.toThrow("DEVICE_BINDING_MISMATCH");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "device-A",
      env.SMPP_GOWM_BINDING_ID,
      "service",
      "ugv",
      "resource",
      true,
    ]);
  });
  it("native migration engine refuses a shared pool before acquiring a connection", async () => {
    const pool = createGowmPool(requireValue(loadGowmStorageConfig(env)));
    const connect = vi.spyOn(pool, "connect");
    await expect(runMigrations(pool)).rejects.toThrow("GOWM_STORAGE_MIGRATION_FORBIDDEN");
    expect(connect).not.toHaveBeenCalled();
    await pool.end();
  });
});
