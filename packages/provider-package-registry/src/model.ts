import { z } from "zod";

export const PROVIDER_PACKAGE_SCHEMA_VERSION = "1.0" as const;

export const PROVIDER_HOSTING_MODES = ["vendor_managed", "platform_managed"] as const;

export const COMPONENT_QUALIFICATION_STATUSES = ["passed", "partial", "pending", "failed"] as const;

export const REAL_RESOURCE_QUALIFICATION_STATUSES = [
  "qualified",
  "pending",
  "failed",
  "not_applicable",
] as const;

const ProviderAdapterSchema = z.strictObject({
  entry: z.string(),
  configSchemaId: z.string(),
  migrationSet: z.string().nullable().optional(),
});

const CompatibleRuntimeSchema = z.strictObject({
  compatibleRuntimeVersion: z.string(),
  protocolMode: z.string().default("frozen_v1"),
});

const ProviderQualificationSchema = z.strictObject({
  componentStatus: z.enum(COMPONENT_QUALIFICATION_STATUSES),
  realResourceStatus: z.enum(REAL_RESOURCE_QUALIFICATION_STATUSES),
  evidenceRefs: z.array(z.string()).optional(),
});

export const ProviderPackageSchema = z.strictObject({
  schemaVersion: z.literal(PROVIDER_PACKAGE_SCHEMA_VERSION),
  packageId: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  packageVersion: z.string().min(1),
  providerType: z.string().min(1),
  hostingModes: z.array(z.enum(PROVIDER_HOSTING_MODES)).refine(allUnique, {
    message: "hostingModes must contain unique values",
  }),
  adapter: ProviderAdapterSchema,
  runtime: CompatibleRuntimeSchema,
  qualification: ProviderQualificationSchema,
});

export type ProviderPackage = z.infer<typeof ProviderPackageSchema>;
export type ProviderHostingMode = (typeof PROVIDER_HOSTING_MODES)[number];
export type ComponentQualificationStatus = (typeof COMPONENT_QUALIFICATION_STATUSES)[number];
export type RealResourceQualificationStatus = (typeof REAL_RESOURCE_QUALIFICATION_STATUSES)[number];

export function parseProviderPackage(input: unknown): ProviderPackage {
  return ProviderPackageSchema.parse(input);
}

function allUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
