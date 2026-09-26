import { z } from "zod";

export const UgvTaskBusinessSettingsSchema = z
  .object({
    schemaVersion: z.literal("sdar.ugv-task-business-settings/1.0-rc2"),
    enabled: z.boolean(),
    visualLockOwner: z.enum(["disabled", "device_native", "provider"]),
    decisionMode: z.enum(["none", "user_required", "agent_allowed"]),
    maxWaitMs: z.number().int().min(1_000).max(3_600_000),
    onExpire: z.enum(["release_and_resume_scan", "end_observation", "reissue_request"]),
    onDismiss: z.enum(["release_and_resume_scan", "end_observation", "reissue_request"]),
    coordinates: z
      .object({
        frameId: z.string().min(1).max(256).optional(),
        transformRef: z.string().min(1).max(256).optional(),
      })
      .strict(),
    trajectory: z
      .object({
        minSamples: z.number().int().min(2).max(100),
        sampleEveryMs: z.number().int().min(100).max(60_000),
      })
      .strict(),
    footprint: z
      .object({
        mode: z.enum(["disabled", "device_reported", "estimated"]),
        model: z.string().min(1).max(256).optional(),
      })
      .strict(),
    coverage: z.object({ mode: z.enum(["disabled", "device_reported", "derived"]) }).strict(),
    adjustments: z.object({ navigation: z.boolean(), reconnaissance: z.boolean() }).strict(),
    contentMode: z.enum(["inline_up_to_limit", "immutable_ref"]),
    maxInlineArtifactBytes: z.number().int().min(1_024).max(1_048_576),
  })
  .strict()
  .superRefine((settings, ctx) => {
    if (!settings.enabled) {
      if (
        settings.visualLockOwner !== "disabled" ||
        settings.decisionMode !== "none" ||
        settings.footprint.mode !== "disabled" ||
        settings.coverage.mode !== "disabled" ||
        settings.adjustments.navigation ||
        settings.adjustments.reconnaissance
      ) {
        ctx.addIssue({ code: "custom", message: "DISABLED_BUSINESS_PROFILE_HAS_ACTIVE_FEATURES" });
      }
    }
    if (settings.decisionMode !== "none" && settings.visualLockOwner === "disabled") {
      ctx.addIssue({ code: "custom", message: "BUSINESS_DECISION_WITHOUT_LOCK_OWNER" });
    }
    if (settings.footprint.mode === "estimated" && !settings.footprint.model) {
      ctx.addIssue({ code: "custom", message: "ESTIMATED_FOOTPRINT_MODEL_REQUIRED" });
    }
    if (settings.footprint.mode === "estimated" && !settings.coordinates.frameId) {
      ctx.addIssue({ code: "custom", message: "ESTIMATED_FOOTPRINT_FRAME_REQUIRED" });
    }
  });
export type UgvTaskBusinessSettings = z.infer<typeof UgvTaskBusinessSettingsSchema>;

export const DISABLED_UGV_TASK_BUSINESS_SETTINGS: UgvTaskBusinessSettings = {
  schemaVersion: "sdar.ugv-task-business-settings/1.0-rc2",
  enabled: false,
  visualLockOwner: "disabled",
  decisionMode: "none",
  maxWaitMs: 300_000,
  onExpire: "release_and_resume_scan",
  onDismiss: "release_and_resume_scan",
  coordinates: {},
  trajectory: { minSamples: 2, sampleEveryMs: 1_000 },
  footprint: { mode: "disabled" },
  coverage: { mode: "disabled" },
  adjustments: { navigation: false, reconnaissance: false },
  contentMode: "inline_up_to_limit",
  maxInlineArtifactBytes: 65_536,
};
