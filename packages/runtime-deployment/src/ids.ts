import { RuntimeDeploymentError } from "./errors.js";

declare const runtimeDeploymentBrand: unique symbol;
type BrandedId<Name extends string> = string & {
  readonly [runtimeDeploymentBrand]: Name;
};

export type RuntimeDeploymentId = BrandedId<"RuntimeDeploymentId">;
export type RuntimeProviderId = BrandedId<"RuntimeProviderId">;
export type RuntimeEnvironmentId = BrandedId<"RuntimeEnvironmentId">;
export type DatabaseProfileId = BrandedId<"DatabaseProfileId">;
export type RuntimeConfigProfileId = BrandedId<"RuntimeConfigProfileId">;

const LogicalIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EnvironmentPattern = /^[a-z][a-z0-9-]{0,62}$/;

export function runtimeDeploymentId(value: string): RuntimeDeploymentId {
  return parseIdentifier(value, "RuntimeDeploymentId", LogicalIdPattern) as RuntimeDeploymentId;
}

export function runtimeProviderId(value: string): RuntimeProviderId {
  return parseIdentifier(value, "RuntimeProviderId", LogicalIdPattern) as RuntimeProviderId;
}

export function runtimeEnvironmentId(value: string): RuntimeEnvironmentId {
  return parseIdentifier(value, "RuntimeEnvironmentId", EnvironmentPattern) as RuntimeEnvironmentId;
}

export function databaseProfileId(value: string): DatabaseProfileId {
  return parseIdentifier(value, "DatabaseProfileId", LogicalIdPattern) as DatabaseProfileId;
}

export function runtimeConfigProfileId(value: string): RuntimeConfigProfileId {
  return parseIdentifier(
    value,
    "RuntimeConfigProfileId",
    LogicalIdPattern,
  ) as RuntimeConfigProfileId;
}

function parseIdentifier(value: string, kind: string, pattern: RegExp): string {
  if (!pattern.test(value)) {
    throw new RuntimeDeploymentError("INVALID_RUNTIME_DEPLOYMENT_IDENTIFIER", `Invalid ${kind}`, {
      kind,
    });
  }
  return value;
}
