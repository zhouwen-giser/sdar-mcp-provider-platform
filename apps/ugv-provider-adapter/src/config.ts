import { loadUgvProviderConfiguration } from "../../../packages/runtime-configuration-contract/src/providers/ugv.js";
import { loadGowmStorageConfig } from "../../../packages/gowm-shared-storage-adapter/src/config.js";
export function loadUgvProviderConfig(env: NodeJS.ProcessEnv = process.env) {
  const gowmStorage = loadGowmStorageConfig(env);
  const config = loadUgvProviderConfiguration(
    gowmStorage
      ? {
          ...env,
          UGV_ADAPTER_DATABASE_URL: gowmStorage.databaseUrl,
          UGV_ADAPTER_STORE_MODE: "postgres",
        }
      : env,
  );
  return { ...config, ...(gowmStorage ? { gowmStorage } : {}) };
}
export type UgvProviderConfig = ReturnType<typeof loadUgvProviderConfig>;
