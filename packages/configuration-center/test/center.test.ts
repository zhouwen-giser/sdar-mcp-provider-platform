import { describe, expect, it } from "vitest";
import { parseConfigurationDefinition } from "@sdar/runtime-configuration-contract";
import {
  ConfigurationCenter,
  createDefaultConfigurationCenter,
  type ConfigurationContent,
} from "../src/index.js";
import type { ConfigurationCenterError } from "../src/index.js";

const definition = parseConfigurationDefinition({
  schemaVersion: "1.0",
  definitionId: "test.runtime",
  definitionVersion: 1,
  configGroup: "test.runtime",
  targetTypes: ["provider_type", "provider"],
  inheritance: {
    enabled: true,
    order: ["provider", "provider_type", "system_default"],
  },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["LOG_LEVEL", "TIMEOUT_MS"],
    properties: {
      LOG_LEVEL: { enum: ["info", "debug"] },
      TIMEOUT_MS: { type: "integer", minimum: 100, maximum: 10_000 },
      ENDPOINT: { type: "string" },
      API_TOKEN_FILE: { type: "string", minLength: 1 },
      PROVIDER_ID: { type: "string", minLength: 1 },
    },
  },
  defaults: { LOG_LEVEL: "info", TIMEOUT_MS: 1000, ENDPOINT: "local" },
  secretPaths: ["/API_TOKEN_FILE"],
  fields: [
    field("LOG_LEVEL", "hot_reload"),
    field("TIMEOUT_MS", "restart_required"),
    field("ENDPOINT", "reconnect_required"),
    field("API_TOKEN_FILE", "restart_required", true),
    field("PROVIDER_ID", "immutable", false, "forbidden"),
  ],
});

describe("ConfigurationCenter", () => {
  it("loads every built-in shared Configuration Definition", () => {
    expect(() => createDefaultConfigurationCenter()).not.toThrow();
  });

  it("loads the Home Assistant Light Provider definition for PMS onboarding", () => {
    const center = createDefaultConfigurationCenter();
    expect(() =>
      center.createDraft({
        draftId: "ha-light-definition-check",
        definitionId: "provider.homeAssistantLight",
        key: {
          environment: "home-lab",
          targetType: "provider",
          targetId: "ha-light-lab",
          configGroup: "provider.homeAssistantLight",
          dataId: "main",
        },
        content: {},
      }),
    ).not.toThrow();
  });

  it("resolves the declared inheritance order and reports field sources", () => {
    const center = new ConfigurationCenter([definition]);
    center.createDraft(
      draft("provider-type", "provider_type", "ugv", {
        LOG_LEVEL: "debug",
        TIMEOUT_MS: 2000,
      }),
    );
    center.createDraft({
      ...draft("provider", "provider", "ugv-1", { TIMEOUT_MS: 3000 }),
      ancestorTargetIds: { provider_type: "ugv" },
    });

    const preview = center.effectivePreview("provider");

    expect(preview.valid).toBe(true);
    expect(preview.content).toMatchObject({
      LOG_LEVEL: "debug",
      TIMEOUT_MS: 3000,
      ENDPOINT: "local",
    });
    expect(preview.sources).toMatchObject({
      "/LOG_LEVEL": "provider_type",
      "/TIMEOUT_MS": "provider",
      "/ENDPOINT": "system_default",
    });
    expect(preview.applyMode).toBe("restart_required");
  });

  it("rejects plaintext secret material before it can be stored or returned", () => {
    const center = new ConfigurationCenter([definition]);

    expect(() =>
      center.createDraft(
        draft("unsafe", "provider", "ugv-1", { API_TOKEN_FILE: "plaintext-token" }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<ConfigurationCenterError>>({
        code: "CONFIGURATION_INPUT_INVALID",
      }),
    );
    expect(() => center.getDraft("unsafe")).toThrow(
      expect.objectContaining<Partial<ConfigurationCenterError>>({
        code: "CONFIGURATION_DRAFT_NOT_FOUND",
      }),
    );
  });

  it("stores SecretRef only and redacts it from effective previews", () => {
    const center = new ConfigurationCenter([definition]);
    center.createDraft(
      draft("safe", "provider", "ugv-1", {
        API_TOKEN_FILE: { secretRef: "local/runtime/ugv-1/token" },
      }),
    );

    expect(center.validateDraft("safe").status).toBe("validated");
    expect(center.effectivePreview("safe").content.API_TOKEN_FILE).toEqual({
      secretRef: "[redacted]",
    });
  });

  it("marks schema-invalid drafts invalid and refuses the publication gate", () => {
    const center = new ConfigurationCenter([definition]);
    center.createDraft(draft("invalid", "provider", "ugv-1", { TIMEOUT_MS: 1 }));

    const result = center.validateDraft("invalid");

    expect(result.status).toBe("invalid");
    expect(result.validationIssues).toContainEqual(
      expect.objectContaining({ code: "SCHEMA_VALIDATION_FAILED", path: "/TIMEOUT_MS" }),
    );
    expect(() => center.requireValidatedDraft("invalid")).toThrow(
      expect.objectContaining<Partial<ConfigurationCenterError>>({
        code: "CONFIGURATION_DRAFT_NOT_VALIDATED",
      }),
    );
  });

  it("rejects immutable overrides and resets validation after optimistic updates", () => {
    const center = new ConfigurationCenter([definition]);
    center.createDraft(draft("immutable", "provider", "ugv-1", { PROVIDER_ID: "other" }));
    expect(center.validateDraft("immutable")).toMatchObject({
      status: "invalid",
      validationIssues: [expect.objectContaining({ code: "IMMUTABLE_OVERRIDE" })],
    });

    center.createDraft(draft("editable", "provider", "ugv-2", { LOG_LEVEL: "debug" }));
    const validated = center.validateDraft("editable");
    expect(validated.status).toBe("validated");
    const updated = center.updateDraft("editable", {
      expectedVersion: validated.version,
      content: { ENDPOINT: "remote" },
    });
    expect(updated.status).toBe("draft");
    expect(updated).not.toHaveProperty("applyMode");
    expect(() => center.updateDraft("editable", { expectedVersion: 1, content: {} })).toThrow(
      expect.objectContaining<Partial<ConfigurationCenterError>>({
        code: "CONFIGURATION_DRAFT_VERSION_CONFLICT",
      }),
    );
  });
});

function draft(
  draftId: string,
  targetType: "provider_type" | "provider",
  targetId: string,
  content: ConfigurationContent,
) {
  return {
    draftId,
    definitionId: definition.definitionId,
    key: {
      environment: "production",
      targetType,
      targetId,
      configGroup: definition.configGroup,
      dataId: "main",
    },
    content,
  } as const;
}

function field(
  name: string,
  applyMode: "hot_reload" | "reconnect_required" | "restart_required" | "immutable",
  secret = false,
  overrideMode: "inheritable" | "forbidden" = "inheritable",
) {
  return {
    path: `/${name}`,
    displayName: name,
    description: `${name} setting`,
    applyMode,
    required: false,
    secret,
    overridePolicy:
      overrideMode === "forbidden"
        ? { mode: "forbidden" as const }
        : {
            mode: "inheritable" as const,
            allowedTargetTypes: ["provider_type", "provider"] as const,
          },
  };
}
