import type { components, operations } from "./generated/contract.js";

export type ContractSchemas = components["schemas"];
export type ProblemDetailsDto = ContractSchemas["ProblemDetails"];
export type ProviderTypeDto = ContractSchemas["ProviderType"];
export type ProviderPackageDto = ContractSchemas["ProviderPackage"];
export type ProviderDto = ContractSchemas["Provider"];
export type ResourceDto = ContractSchemas["Resource"];
export type ProviderResourceBindingDto = ContractSchemas["ProviderResourceBinding"];
export type ConfigurationDraftDto = ContractSchemas["ConfigurationDraft"];
export type EffectiveConfigurationPreviewDto = ContractSchemas["EffectiveConfigurationPreview"];
export type ConfigurationPublicationResultDto = ContractSchemas["ConfigurationPublicationResult"];
export type ConfigRevisionDto = ContractSchemas["ConfigRevision"];
export type RuntimeDeploymentDto = ContractSchemas["RuntimeDeployment"];
export type RuntimeDeploymentIntentDto = ContractSchemas["RuntimeDeploymentIntent"];
export type RuntimeProcessDto = ContractSchemas["RuntimeProcess"];
export type RegistrySnapshotDto = ContractSchemas["RegistrySnapshot"];
export type RegistryDiffDto = ContractSchemas["RegistryDiff"];
export type AuditEventDto = ContractSchemas["AuditEvent"];
export type SecretRefDto = ContractSchemas["SecretRef"];

export type OperationName = keyof operations;
export type RequestBody<K extends OperationName> = operations[K] extends {
  requestBody: { content: { "application/json": infer T } };
} ? T : never;

export const CONTRACT_VERSION = "1.0.0" as const;
export const CONTRACT_STATUS = "frozen" as const;
export const CONTRACT_OPENAPI_SHA256 = "dddf9a6c9a5d8264b71aa11495106e197857e186b02fd8e54fc0f0a53e33f042" as const;
