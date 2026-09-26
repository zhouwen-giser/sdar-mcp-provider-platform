import { loadUgvProviderConfiguration } from "../../../packages/runtime-configuration-contract/src/providers/ugv.js";
import {
  DISABLED_UGV_TASK_BUSINESS_SETTINGS,
  UgvTaskBusinessSettingsSchema,
} from "../../../packages/runtime-configuration-contract/src/providers/ugv-business.js";
import { loadGowmStorageConfig } from "../../../packages/gowm-shared-storage-adapter/src/config.js";
import { readFileSync } from "node:fs";
import { assertUgvTaskBusinessSettingsSupported } from "./task-business-bootstrap.js";
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
  const taskBusinessSettings = config.UGV_TASK_BUSINESS_PROFILE_PATH
    ? UgvTaskBusinessSettingsSchema.parse(
        JSON.parse(readFileSync(config.UGV_TASK_BUSINESS_PROFILE_PATH, "utf8")) as unknown,
      )
    : DISABLED_UGV_TASK_BUSINESS_SETTINGS;
  assertUgvTaskBusinessSettingsSupported(taskBusinessSettings);
  return { ...config, taskBusinessSettings, ...(gowmStorage ? { gowmStorage } : {}) };
}
export type UgvProviderConfig = ReturnType<typeof loadUgvProviderConfig>;
