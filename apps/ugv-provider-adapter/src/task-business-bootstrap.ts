import {
  PostgresProviderStore,
  PostgresTaskBusinessStore,
  openGowmTaskBusinessStore,
  verifyNativeTaskBusinessSchema,
  type ProviderStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import type { GowmStorageConfig } from "../../../packages/gowm-shared-storage-adapter/src/config.js";
import type { UgvTaskBusinessSettings } from "../../../packages/runtime-configuration-contract/src/providers/ugv-business.js";

/** Keep an enabled deployment profile equal to the capabilities wired by this adapter. */
export function assertUgvTaskBusinessSettingsSupported(settings: UgvTaskBusinessSettings): void {
  if (!settings.enabled) return;
  if (settings.decisionMode !== "none") throw new Error("UGV_BUSINESS_DECISION_NOT_WIRED");
  if (settings.visualLockOwner !== "disabled")
    throw new Error("UGV_BUSINESS_VISUAL_LOCK_NOT_QUALIFIED");
  if (settings.footprint.mode !== "disabled")
    throw new Error("UGV_BUSINESS_FOOTPRINT_NOT_QUALIFIED");
  if (settings.coverage.mode !== "device_reported")
    throw new Error("UGV_BUSINESS_COVERAGE_MODE_MISMATCH");
  if (settings.adjustments.navigation || settings.adjustments.reconnaissance)
    throw new Error("UGV_BUSINESS_ADJUSTMENT_NOT_WIRED");
  if (settings.coordinates.frameId || settings.coordinates.transformRef)
    throw new Error("UGV_BUSINESS_COORDINATE_POLICY_NOT_WIRED");
  if (settings.trajectory.minSamples !== 2 || settings.trajectory.sampleEveryMs !== 1_000)
    throw new Error("UGV_BUSINESS_TRAJECTORY_POLICY_NOT_WIRED");
  if (
    settings.maxWaitMs !== 300_000 ||
    settings.onExpire !== "release_and_resume_scan" ||
    settings.onDismiss !== "release_and_resume_scan"
  )
    throw new Error("UGV_BUSINESS_INPUT_POLICY_NOT_WIRED");
  if (settings.contentMode !== "inline_up_to_limit" || settings.maxInlineArtifactBytes !== 65_536)
    throw new Error("UGV_BUSINESS_CONTENT_POLICY_NOT_WIRED");
}

/** Startup gate: no native/Memory fallback for a requested GOWM shared profile. */
export async function openUgvTaskBusinessStore(
  store: ProviderStore,
  settings: UgvTaskBusinessSettings,
  gowm?: GowmStorageConfig,
): Promise<PostgresTaskBusinessStore | undefined> {
  if (!settings.enabled) return undefined;
  assertUgvTaskBusinessSettingsSupported(settings);
  if (!(store instanceof PostgresProviderStore)) {
    throw new Error("UGV_TASK_BUSINESS_POSTGRES_REQUIRED");
  }
  const business = gowm
    ? await openGowmTaskBusinessStore(store.pool, gowm)
    : new PostgresTaskBusinessStore(store.pool);
  if (!gowm) await verifyNativeTaskBusinessSchema(store.pool);
  store.enableTaskBusinessSource(business);
  return business;
}
