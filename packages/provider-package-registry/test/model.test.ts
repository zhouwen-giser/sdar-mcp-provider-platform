import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  PROVIDER_PACKAGE_SCHEMA_VERSION,
  ProviderPackageSchema,
  parseProviderPackage,
} from "../src/index.js";

const validPackage = {
  schemaVersion: "1.0",
  packageId: "builtin.isr.vehicle.ugv",
  packageVersion: "1.0.0",
  providerType: "isr.vehicle.ugv",
  hostingModes: ["vendor_managed", "platform_managed"],
  adapter: {
    entry: "dist/apps/ugv-provider-adapter/src/main.js",
    configSchemaId: "https://sdar.local/schemas/ugv-provider-config-v1.json",
    migrationSet: "provider:ugv",
  },
  runtime: {
    compatibleRuntimeVersion: "2.0.0-rc.1",
  },
  qualification: {
    componentStatus: "passed",
    realResourceStatus: "pending",
    evidenceRefs: ["reports/ugv-provider-v1/component.json"],
  },
} as const;

let validateJsonSchema: ValidateFunction;

beforeAll(async () => {
  const schemaPath = fileURLToPath(
    new URL("../../../schemas/provider-package-v1.json", import.meta.url),
  );
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
  validateJsonSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
});

describe("ProviderPackage model", () => {
  it("accepts a valid package and applies the frozen protocol default", () => {
    expect(parseProviderPackage(validPackage)).toEqual({
      ...validPackage,
      runtime: {
        ...validPackage.runtime,
        protocolMode: "frozen_v1",
      },
    });
    expect(validateJsonSchema(validPackage)).toBe(true);
  });

  it("rejects required-field omissions in both validators", () => {
    const missingQualification: Record<string, unknown> = { ...validPackage };
    delete missingQualification.qualification;

    expect(ProviderPackageSchema.safeParse(missingQualification).success).toBe(false);
    expect(validateJsonSchema(missingQualification)).toBe(false);
  });

  it("rejects unknown and duplicate hosting modes", () => {
    const unknownMode = {
      ...validPackage,
      hostingModes: ["vendor_managed", "externally_managed"],
    };
    const duplicateMode = {
      ...validPackage,
      hostingModes: ["vendor_managed", "vendor_managed"],
    };

    expect(ProviderPackageSchema.safeParse(unknownMode).success).toBe(false);
    expect(validateJsonSchema(unknownMode)).toBe(false);
    expect(ProviderPackageSchema.safeParse(duplicateMode).success).toBe(false);
    expect(validateJsonSchema(duplicateMode)).toBe(false);
  });

  it("rejects additional properties at every object boundary", () => {
    const unknownTopLevel = { ...validPackage, certified: true };
    const unknownAdapterField = {
      ...validPackage,
      adapter: { ...validPackage.adapter, arbitraryCommand: "node arbitrary.js" },
    };

    expect(ProviderPackageSchema.safeParse(unknownTopLevel).success).toBe(false);
    expect(validateJsonSchema(unknownTopLevel)).toBe(false);
    expect(ProviderPackageSchema.safeParse(unknownAdapterField).success).toBe(false);
    expect(validateJsonSchema(unknownAdapterField)).toBe(false);
  });

  it("exports the task-package schema identity for PMS consumers", async () => {
    const schemaPath = fileURLToPath(
      new URL("../../../schemas/provider-package-v1.json", import.meta.url),
    );
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
      $id: string;
      properties: { schemaVersion: { const: string } };
      additionalProperties: boolean;
    };

    expect(schema.$id).toBe("https://sdar.local/schemas/provider-package-v1.json");
    expect(schema.properties.schemaVersion.const).toBe(PROVIDER_PACKAGE_SCHEMA_VERSION);
    expect(schema.additionalProperties).toBe(false);
  });
});
