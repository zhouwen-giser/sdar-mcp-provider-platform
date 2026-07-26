import { describe, expect, it } from "vitest";
import {
  CONFIGURATION_APPLY_MODES,
  canonicalJson,
  canonicalSha256,
  parseConfigurationDefinition,
} from "../src/index.js";

describe("ConfigurationDefinition", () => {
  it("parses field metadata, target inheritance, defaults, and secret paths", () => {
    const definition = definitionFixture();

    expect(parseConfigurationDefinition(definition)).toEqual(definition);
    expect(CONFIGURATION_APPLY_MODES).toEqual([
      "hot_reload",
      "reconnect_required",
      "restart_required",
      "immutable",
    ]);
  });

  it("rejects an invalid Apply Mode with a stable error code", () => {
    const definition = definitionFixture();
    definition.fields[1] = { ...fieldAt(definition, 1), applyMode: "live_magic" };

    expect(() => parseConfigurationDefinition(definition)).toThrow(
      expect.objectContaining({ code: "CONFIGURATION_DEFINITION_INVALID" }),
    );
  });

  it("requires Secret paths to exactly match Secret field metadata", () => {
    const definition = definitionFixture();
    definition.secretPaths = [];

    expect(() => parseConfigurationDefinition(definition)).toThrow(
      expect.objectContaining({ code: "SECRET_PATH_MISMATCH" }),
    );
  });

  it("forbids overrides of immutable fields", () => {
    const definition = definitionFixture();
    definition.fields[0] = {
      ...fieldAt(definition, 0),
      overridePolicy: { mode: "inheritable" },
    };

    expect(() => parseConfigurationDefinition(definition)).toThrow(
      expect.objectContaining({ code: "IMMUTABLE_OVERRIDE_POLICY_INVALID" }),
    );
  });

  it("validates inheritance shape and override target scope", () => {
    const invalidOrder = definitionFixture();
    invalidOrder.inheritance.order = ["environment"];
    expect(() => parseConfigurationDefinition(invalidOrder)).toThrow(
      expect.objectContaining({ code: "INHERITANCE_ORDER_INVALID" }),
    );

    const outsideTarget = definitionFixture();
    outsideTarget.fields[1] = {
      ...fieldAt(outsideTarget, 1),
      overridePolicy: {
        mode: "inheritable",
        allowedTargetTypes: ["collector"],
      },
    };
    expect(() => parseConfigurationDefinition(outsideTarget)).toThrow(
      expect.objectContaining({ code: "OVERRIDE_TARGET_OUTSIDE_DEFINITION" }),
    );
  });
});

describe("canonical configuration serialization", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const left = { z: 1, nested: { beta: true, alpha: "x" }, list: [{ y: 2, x: 1 }, 3] };
    const right = { list: [{ x: 1, y: 2 }, 3], nested: { alpha: "x", beta: true }, z: 1 };

    expect(canonicalJson(left)).toBe(
      '{"list":[{"x":1,"y":2},3],"nested":{"alpha":"x","beta":true},"z":1}',
    );
    expect(canonicalJson(right)).toBe(canonicalJson(left));
    expect(canonicalSha256(right)).toBe(canonicalSha256(left));
    expect(canonicalSha256(right)).toBe(
      "45c07720dfe7fed988e44678b047052cde38f1c61fba448b4283d29708015be6",
    );
  });

  it("rejects cycles and non-JSON values with stable codes", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => canonicalJson(cyclic)).toThrow(
      expect.objectContaining({ code: "CANONICAL_JSON_CYCLE" }),
    );
    expect(() => canonicalJson({ value: undefined })).toThrow(
      expect.objectContaining({ code: "CANONICAL_JSON_VALUE_INVALID" }),
    );
  });
});

function definitionFixture() {
  return {
    schemaVersion: "1.0" as const,
    definitionId: "runtime.otel",
    definitionVersion: 1,
    configGroup: "runtime.otel",
    targetTypes: [
      "environment",
      "provider_type",
      "provider",
      "runtime_deployment",
      "runtime_instance",
    ] as const,
    inheritance: {
      enabled: true,
      order: [
        "runtime_instance",
        "runtime_deployment",
        "provider",
        "provider_type",
        "environment",
        "system_default",
      ] as (
        | "runtime_instance"
        | "runtime_deployment"
        | "provider"
        | "provider_type"
        | "environment"
        | "system_default"
      )[],
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        providerId: { type: "string" },
        enabled: { type: "boolean" },
        headersFile: { type: "string" },
      },
    },
    defaults: { enabled: false },
    secretPaths: ["/headersFile"],
    fields: [
      {
        path: "/providerId",
        displayName: "Provider ID",
        description: "Immutable Provider identity.",
        applyMode: "immutable",
        required: true,
        secret: false,
        overridePolicy: { mode: "forbidden" },
      },
      {
        path: "/enabled",
        displayName: "Enabled",
        description: "Enables OTLP export.",
        applyMode: "hot_reload",
        required: false,
        secret: false,
        overridePolicy: {
          mode: "inheritable",
          allowedTargetTypes: ["environment", "provider_type", "provider"],
        },
      },
      {
        path: "/headersFile",
        displayName: "Headers file",
        description: "Secret-bearing OTLP headers file.",
        applyMode: "reconnect_required",
        required: false,
        secret: true,
        overridePolicy: {
          mode: "target_only",
          allowedTargetTypes: ["runtime_deployment", "runtime_instance"],
        },
      },
    ],
  };
}

function fieldAt(definition: ReturnType<typeof definitionFixture>, index: number) {
  const field = definition.fields[index];
  if (field === undefined) throw new Error(`Missing fixture field ${index.toString()}`);
  return field;
}
