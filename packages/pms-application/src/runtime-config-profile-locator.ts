import { Buffer } from "node:buffer";
import {
  environmentId,
  type ConfigurationTarget,
  type ConfigurationTargetType,
} from "../../pms-domain/src/index.js";

export interface RuntimeConfigProfileLocator {
  readonly environment: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly configGroup: string;
  readonly dataId: string;
}

const PROFILE_PREFIX = "rtcfg";
const PROFILE_VERSION = "v1";
const RUNTIME_DEPLOYMENT_PROFILE_TYPE: ConfigurationTargetType = "runtime_deployment";
const RUNTIME_PROFILE_TYPES: readonly ConfigurationTargetType[] = [
  "runtime_deployment",
  "runtime_instance",
];

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function parseRuntimeConfigProfileLocator(value: string): RuntimeConfigProfileLocator {
  if (typeof value !== "string") {
    throw new TypeError("Runtime config profile identifier must be a string");
  }
  const parts = value.split(".");
  if (parts.length !== 7 || parts[0] !== PROFILE_PREFIX || parts[1] !== PROFILE_VERSION) {
    throw new TypeError("Invalid runtime config profile identifier format");
  }
  const environment = decodePart(parts[2] ?? "", "environment");
  const targetType = decodePart(parts[3] ?? "", "targetType") as ConfigurationTargetType;
  if (!RUNTIME_PROFILE_TYPES.includes(targetType)) {
    throw new TypeError(
      "Runtime config profile target type must be runtime_deployment or runtime_instance",
    );
  }
  const targetId = decodePart(parts[4] ?? "", "targetId");
  const configGroup = decodePart(parts[5] ?? "", "configGroup");
  const dataId = decodePart(parts[6] ?? "", "dataId");
  const validatedEnvironment = environmentId(environment);
  return Object.freeze({
    environment: validatedEnvironment,
    targetType,
    targetId,
    configGroup,
    dataId,
  });
}

export function formatRuntimeConfigProfileLocator(locator: RuntimeConfigProfileLocator): string {
  const targetType = validateTargetType(locator.targetType);
  const { environment, targetId, configGroup, dataId } = locator;
  if (
    environment.trim().length === 0 ||
    targetId.trim().length === 0 ||
    configGroup.trim().length === 0 ||
    dataId.trim().length === 0
  ) {
    throw new TypeError("Runtime config profile locator fields must be non-empty");
  }
  const identifier =
    `${PROFILE_PREFIX}.${PROFILE_VERSION}.` +
    [environment, targetType, targetId, configGroup, dataId].map(encodePart).join(".");
  if (identifier.length > 128 || !IDENTIFIER_PATTERN.test(identifier)) {
    throw new TypeError("Runtime config profile identifier is not a valid identifier");
  }
  return identifier;
}

export function runtimeDeploymentProfileLocator(
  locator: Omit<RuntimeConfigProfileLocator, "targetType"> & {
    readonly targetType?: RuntimeConfigProfileLocator["targetType"];
  },
): RuntimeConfigProfileLocator {
  return Object.freeze({
    ...locator,
    targetType: locator.targetType ?? RUNTIME_DEPLOYMENT_PROFILE_TYPE,
  });
}

export function toConfigurationTarget(locator: RuntimeConfigProfileLocator): ConfigurationTarget {
  return Object.freeze({
    environment: environmentId(locator.environment),
    targetType: validateTargetType(locator.targetType),
    targetId: locator.targetId,
    configGroup: locator.configGroup,
    dataId: locator.dataId,
  });
}

function encodePart(value: string): string {
  if (value.length === 0) throw new TypeError("Runtime config profile locator part is empty");
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodePart(value: string, field: string): string {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (decoded.length === 0 || !/^[ -~]+$/.test(decoded)) {
      throw new TypeError(`Runtime config profile locator field ${field} decode failed`);
    }
    return decoded;
  } catch {
    throw new TypeError(`Runtime config profile locator field ${field} decode failed`);
  }
}

function validateTargetType(value: string): ConfigurationTargetType {
  if (value !== "runtime_deployment" && value !== "runtime_instance") {
    throw new TypeError("Unsupported runtime config target type");
  }
  return value;
}
