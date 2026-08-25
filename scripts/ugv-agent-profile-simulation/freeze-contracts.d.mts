export interface FrozenToolContract {
  name: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  inputSchemaCanonicalHash: string;
  outputSchemaCanonicalHash: string | null;
  schemaCanonicalHash: string;
  toolCanonicalHash: string;
}

export interface FrozenDeviceContract {
  tools: FrozenToolContract[];
  [key: string]: unknown;
}

export interface FrozenMqttSubscription {
  topic: string;
  qos: 0 | 1;
}

export interface FrozenMqttContract {
  subscriptions: FrozenMqttSubscription[];
  [key: string]: unknown;
}

export interface FrozenContractEnvelope<TContract> {
  schemaVersion: string;
  generatedAt: string;
  status: "FROZEN";
  evidenceClass: "external_simulation";
  productionEligible: false;
  physicalVehicleQualified: false;
  contractCanonicalHash: string;
  contract: TContract;
}

export interface ExternalContractReports {
  device: FrozenContractEnvelope<FrozenDeviceContract>;
  mqtt: FrozenContractEnvelope<FrozenMqttContract>;
}

export interface FreezeExternalContractOptions {
  inputPath?: string;
  outputDirectory?: string;
  mode: "write" | "check";
}

export class ExternalContractFreezeError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, options?: ErrorOptions);
}

export function buildExternalContractReports(preflight: unknown): ExternalContractReports;

export function freezeExternalContracts(options: FreezeExternalContractOptions): Promise<{
  paths: { device: string; mqtt: string };
  reports: ExternalContractReports;
}>;
