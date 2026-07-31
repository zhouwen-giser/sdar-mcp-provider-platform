# Contract Capability Matrix

The frozen contract is the only API authority. Each operation is consumed through a domain Gateway and Query/Mutation hook; no Feature imports generated DTO types directly.

| Operation ID | Method | Frozen path | UI use |
|---|---|---|---|
| `bindProviderResource` | POST | `/providers/{providerId}/resource-bindings` | FROZEN_API or WEB_COMPOSED domain flow |
| `createConfigurationDraft` | POST | `/configuration-drafts` | FROZEN_API or WEB_COMPOSED domain flow |
| `createProvider` | POST | `/providers` | FROZEN_API or WEB_COMPOSED domain flow |
| `createResource` | POST | `/resources` | FROZEN_API or WEB_COMPOSED domain flow |
| `createRuntimeDeployment` | POST | `/runtime-deployments` | FROZEN_API or WEB_COMPOSED domain flow |
| `diffRegistrySnapshots` | GET | `/registry/{environment}/diff` | FROZEN_API or WEB_COMPOSED domain flow |
| `getConfigurationDraft` | GET | `/configuration-drafts/{draftId}` | FROZEN_API or WEB_COMPOSED domain flow |
| `getLatestRegistrySnapshot` | GET | `/registry/{environment}/latest` | FROZEN_API or WEB_COMPOSED domain flow |
| `getProvider` | GET | `/providers/{providerId}` | FROZEN_API or WEB_COMPOSED domain flow |
| `getProviderPackage` | GET | `/provider-packages/{packageId}` | FROZEN_API or WEB_COMPOSED domain flow |
| `getProviderType` | GET | `/provider-types/{providerTypeId}` | FROZEN_API or WEB_COMPOSED domain flow |
| `getResource` | GET | `/resources/{environment}/{resourceId}` | FROZEN_API or WEB_COMPOSED domain flow |
| `getRuntimeDeployment` | GET | `/runtime-deployments/{deploymentId}` | FROZEN_API or WEB_COMPOSED domain flow |
| `getRuntimeProcess` | GET | `/runtime-processes/{instanceId}` | FROZEN_API or WEB_COMPOSED domain flow |
| `listAuditEvents` | GET | `/audit-events` | FROZEN_API or WEB_COMPOSED domain flow |
| `listProviderPackages` | GET | `/provider-packages` | FROZEN_API or WEB_COMPOSED domain flow |
| `listProviderResourceBindings` | GET | `/providers/{providerId}/resource-bindings` | FROZEN_API or WEB_COMPOSED domain flow |
| `listProviderTypes` | GET | `/provider-types` | FROZEN_API or WEB_COMPOSED domain flow |
| `listProviders` | GET | `/providers` | FROZEN_API or WEB_COMPOSED domain flow |
| `listRegistryHistory` | GET | `/registry/{environment}/history` | FROZEN_API or WEB_COMPOSED domain flow |
| `listResources` | GET | `/resources` | FROZEN_API or WEB_COMPOSED domain flow |
| `listRuntimeDeployments` | GET | `/runtime-deployments` | FROZEN_API or WEB_COMPOSED domain flow |
| `listRuntimeProcesses` | GET | `/runtime-processes` | FROZEN_API or WEB_COMPOSED domain flow |
| `previewEffectiveConfiguration` | GET | `/configuration-drafts/{draftId}/effective` | FROZEN_API or WEB_COMPOSED domain flow |
| `publishConfigurationDraft` | POST | `/configuration-drafts/{draftId}/publish` | FROZEN_API or WEB_COMPOSED domain flow |
| `reconcileRuntimeDeployment` | POST | `/runtime-deployments/{deploymentId}/reconcile` | FROZEN_API or WEB_COMPOSED domain flow |
| `restartRuntimeDeployment` | POST | `/runtime-deployments/{deploymentId}/restart` | FROZEN_API or WEB_COMPOSED domain flow |
| `rollbackConfigurationDraft` | POST | `/configuration-drafts/{draftId}/rollback` | FROZEN_API or WEB_COMPOSED domain flow |
| `scaleRuntimeDeployment` | POST | `/runtime-deployments/{deploymentId}/scale` | FROZEN_API or WEB_COMPOSED domain flow |
| `startRuntimeDeployment` | POST | `/runtime-deployments/{deploymentId}/start` | FROZEN_API or WEB_COMPOSED domain flow |
| `stopRuntimeDeployment` | POST | `/runtime-deployments/{deploymentId}/stop` | FROZEN_API or WEB_COMPOSED domain flow |
| `unbindProviderResource` | DELETE | `/providers/{providerId}/resource-bindings/{environment}/{resourceId}` | FROZEN_API or WEB_COMPOSED domain flow |
| `updateConfigurationDraft` | PATCH | `/configuration-drafts/{draftId}` | FROZEN_API or WEB_COMPOSED domain flow |
| `updateProviderStatus` | PATCH | `/providers/{providerId}/status` | FROZEN_API or WEB_COMPOSED domain flow |
| `updateResourceStatus` | PATCH | `/resources/{environment}/{resourceId}/status` | FROZEN_API or WEB_COMPOSED domain flow |
| `validateConfigurationDraft` | POST | `/configuration-drafts/{draftId}/validate` | FROZEN_API or WEB_COMPOSED domain flow |

## Contract boundary totals

- Frozen operations mapped: 36
- Deferred product routes: 18
- API data mode does not silently fall back to Mock; it shows a controlled unconfigured page.
