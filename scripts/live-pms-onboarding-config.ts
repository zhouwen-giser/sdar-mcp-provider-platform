import { resolve } from "node:path";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8090";
const DEFAULT_CLIMATE_ADAPTER_HOST = "127.0.0.1";
const DEFAULT_CLIMATE_ADAPTER_PORT = 17_020;
const DEFAULT_LIGHT_ADAPTER_HOST = "127.0.0.1";
const DEFAULT_LIGHT_ADAPTER_PORT = 17_021;
const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const POSTGRES_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

export interface LivePmsOnboardingProviderConfig {
  readonly providerId: string;
  readonly providerTypeId: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly adapterHost: string;
  readonly adapterPort: number;
  readonly adapterEndpoint: string;
  readonly deploymentId: string;
  readonly databaseProfileId: string;
  readonly configDraftId: string;
  readonly databaseMode: "provisioned" | "preexisting";
  readonly databaseName?: string;
}

export interface LivePmsOnboardingConfig {
  readonly root: string;
  readonly localStateRoot: string;
  readonly apiBaseUrl: string;
  readonly paths: {
    readonly resources: string;
    readonly databaseUrl: string;
    readonly managementToken: string;
    readonly provisioning: string;
    readonly climateResources: string;
    readonly lightResources: string;
    readonly climateState: string;
    readonly lightState: string;
  };
  readonly providers: {
    readonly climate: LivePmsOnboardingProviderConfig;
    readonly light: LivePmsOnboardingProviderConfig;
  };
}

export function resolveLivePmsOnboardingConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  repositoryRoot = resolve(process.cwd()),
): LivePmsOnboardingConfig {
  const root = resolve(repositoryRoot);
  const localStateRoot = resolveLocalStateRoot(root, environment.SMPP_LOCAL_STATE_ROOT);
  const apiBaseUrl = parseApiBaseUrl(environment.SMPP_PMS_API_URL ?? DEFAULT_API_BASE_URL);
  const climate = providerConfig({
    providerId: "ha-climate-lab",
    providerTypeId: "home_assistant.climate",
    packageId: "builtin.home-assistant.climate",
    packageVersion: "0.1.0",
    adapterHost: environment.SMPP_CLIMATE_ADAPTER_HOST ?? DEFAULT_CLIMATE_ADAPTER_HOST,
    adapterPort: environment.SMPP_CLIMATE_ADAPTER_PORT,
    defaultAdapterPort: DEFAULT_CLIMATE_ADAPTER_PORT,
    deploymentId: "ha-climate-deployment",
    databaseProfileId: "ha-climate-db-profile",
    configDraftId: "ha-climate-runtime-config",
    databaseName: environment.SMPP_CLIMATE_RUNTIME_DATABASE_NAME,
  });
  const light = providerConfig({
    providerId: "ha-light-lab",
    providerTypeId: "home_assistant.light",
    packageId: "builtin.home-assistant.light",
    packageVersion: "0.1.0",
    adapterHost: environment.SMPP_LIGHT_ADAPTER_HOST ?? DEFAULT_LIGHT_ADAPTER_HOST,
    adapterPort: environment.SMPP_LIGHT_ADAPTER_PORT,
    defaultAdapterPort: DEFAULT_LIGHT_ADAPTER_PORT,
    deploymentId: "ha-light-deployment",
    databaseProfileId: "ha-light-db-profile",
    configDraftId: "ha-light-runtime-config",
    databaseName: environment.SMPP_LIGHT_RUNTIME_DATABASE_NAME,
  });

  return Object.freeze({
    root,
    localStateRoot,
    apiBaseUrl,
    paths: Object.freeze({
      resources: resolve(localStateRoot, "ha-real-device/resources.local.json"),
      databaseUrl: resolve(localStateRoot, "pms-continuation/secrets/pms-database-url"),
      managementToken: resolve(localStateRoot, "pms-continuation/secrets/pms-management.token"),
      provisioning: resolve(localStateRoot, "pms-continuation/secrets/postgres-provisioning.json"),
      climateResources: resolve(localStateRoot, "pms-continuation/config/climates.json"),
      lightResources: resolve(localStateRoot, "pms-continuation/config/lights.json"),
      climateState: resolve(localStateRoot, "pms-continuation/roots/provider-state/climate.json"),
      lightState: resolve(localStateRoot, "pms-continuation/roots/provider-state/light.json"),
    }),
    providers: Object.freeze({ climate, light }),
  });
}

function resolveLocalStateRoot(repositoryRoot: string, value: string | undefined): string {
  if (value === undefined) return resolve(repositoryRoot, ".local");
  if (value.trim() === "") throw new Error("SMPP_LOCAL_STATE_ROOT_INVALID");
  return resolve(repositoryRoot, value);
}

function providerConfig(input: {
  readonly providerId: string;
  readonly providerTypeId: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly adapterHost: string;
  readonly adapterPort: string | undefined;
  readonly defaultAdapterPort: number;
  readonly deploymentId: string;
  readonly databaseProfileId: string;
  readonly configDraftId: string;
  readonly databaseName: string | undefined;
}): LivePmsOnboardingProviderConfig {
  const adapterHost = parseAdapterHost(input.adapterHost);
  const adapterPort = parseAdapterPort(input.adapterPort, input.defaultAdapterPort);
  const databaseName = parseOptionalDatabaseName(input.databaseName);
  return Object.freeze({
    providerId: input.providerId,
    providerTypeId: input.providerTypeId,
    packageId: input.packageId,
    packageVersion: input.packageVersion,
    adapterHost,
    adapterPort,
    adapterEndpoint: `${adapterHost}:${String(adapterPort)}`,
    deploymentId: input.deploymentId,
    databaseProfileId: input.databaseProfileId,
    configDraftId: input.configDraftId,
    databaseMode: databaseName === undefined ? "provisioned" : "preexisting",
    ...(databaseName === undefined ? {} : { databaseName }),
  });
}

function parseApiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SMPP_PMS_API_URL_INVALID");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new Error("SMPP_PMS_API_URL_INVALID");
  }
  return url.origin;
}

function parseAdapterHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (!HOST.test(host) || host.includes("..")) throw new Error("SMPP_ADAPTER_HOST_INVALID");
  return host;
}

function parseAdapterPort(value: string | undefined, defaultPort: number): number {
  if (value === undefined) return defaultPort;
  if (!/^\d+$/.test(value)) throw new Error("SMPP_ADAPTER_PORT_INVALID");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMPP_ADAPTER_PORT_INVALID");
  }
  return port;
}

function parseOptionalDatabaseName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!POSTGRES_IDENTIFIER.test(value)) throw new Error("SMPP_RUNTIME_DATABASE_NAME_INVALID");
  return value;
}
