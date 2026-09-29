import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadUgvProviderConfig } from "../../apps/ugv-provider-adapter/src/config.js";
import { openUgvTaskBusinessStore } from "../../apps/ugv-provider-adapter/src/task-business-bootstrap.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import {
  DISABLED_UGV_TASK_BUSINESS_SETTINGS,
  UgvTaskBusinessSettingsSchema,
} from "../../packages/runtime-configuration-contract/src/providers/ugv-business.js";
import { loadUgvProviderConfiguration } from "../../packages/runtime-configuration-contract/src/providers/ugv.js";

const path = "examples/gowm-shared-storage/task-business-profile.example.json";

describe("UGV task business settings", () => {
  it("defaults off and parses the checked-in inactive example", () => {
    expect(loadUgvProviderConfig({}).taskBusinessSettings).toEqual(
      DISABLED_UGV_TASK_BUSINESS_SETTINGS,
    );
    expect(loadUgvProviderConfiguration({ UGV_TASK_BUSINESS_PROFILE_PATH: path })).toMatchObject({
      UGV_TASK_BUSINESS_PROFILE_PATH: path,
    });
    expect(
      loadUgvProviderConfig({ UGV_TASK_BUSINESS_PROFILE_PATH: path }).taskBusinessSettings,
    ).toEqual(UgvTaskBusinessSettingsSchema.parse(JSON.parse(readFileSync(path, "utf8"))));
  });

  it("rejects contradictory disabled settings and an estimated footprint without model/frame", () => {
    expect(
      UgvTaskBusinessSettingsSchema.safeParse({
        ...DISABLED_UGV_TASK_BUSINESS_SETTINGS,
        adjustments: { navigation: true, reconnaissance: false },
      }).success,
    ).toBe(false);
    expect(
      UgvTaskBusinessSettingsSchema.safeParse({
        ...DISABLED_UGV_TASK_BUSINESS_SETTINGS,
        enabled: true,
        footprint: { mode: "estimated" },
      }).success,
    ).toBe(false);
  });

  it("accepts only the wired read-only profile and refuses a Memory startup fallback", async () => {
    const configured = UgvTaskBusinessSettingsSchema.parse({
      ...DISABLED_UGV_TASK_BUSINESS_SETTINGS,
      enabled: true,
      coverage: { mode: "device_reported" },
    });
    expect(configured.enabled).toBe(true);
    const configuredPath = join(
      mkdtempSync(join(tmpdir(), "smpp-task-business-profile-")),
      "profile.json",
    );
    writeFileSync(configuredPath, JSON.stringify(configured));
    const loaded = loadUgvProviderConfig({ UGV_TASK_BUSINESS_PROFILE_PATH: configuredPath });
    expect(loaded.taskBusinessSettings.enabled).toBe(true);
    await expect(
      openUgvTaskBusinessStore(new MemoryProviderStore(), loaded.taskBusinessSettings),
    ).rejects.toThrow("UGV_TASK_BUSINESS_POSTGRES_REQUIRED");
    expect(() =>
      loadUgvProviderConfig({ UGV_TASK_BUSINESS_PROFILE_PATH: "does-not-exist.json" }),
    ).toThrow();
  });

  it("fails startup for configured decisions, native lock, adjustment or unsupported coverage", () => {
    const configuredPath = join(
      mkdtempSync(join(tmpdir(), "smpp-task-business-qualification-")),
      "profile.json",
    );
    const readOnly = {
      ...DISABLED_UGV_TASK_BUSINESS_SETTINGS,
      enabled: true,
      coverage: { mode: "device_reported" as const },
    };
    for (const [settings, reason] of [
      [{ ...readOnly, visualLockOwner: "device_native" }, "UGV_BUSINESS_VISUAL_LOCK_NOT_QUALIFIED"],
      [
        { ...readOnly, visualLockOwner: "device_native", decisionMode: "user_required" },
        "UGV_BUSINESS_DECISION_NOT_WIRED",
      ],
      [
        { ...readOnly, adjustments: { navigation: true, reconnaissance: false } },
        "UGV_BUSINESS_ADJUSTMENT_NOT_WIRED",
      ],
      [{ ...readOnly, coverage: { mode: "disabled" } }, "UGV_BUSINESS_COVERAGE_MODE_MISMATCH"],
    ] as const) {
      writeFileSync(configuredPath, JSON.stringify(settings));
      expect(() =>
        loadUgvProviderConfig({ UGV_TASK_BUSINESS_PROFILE_PATH: configuredPath }),
      ).toThrow(reason);
    }
  });
});
