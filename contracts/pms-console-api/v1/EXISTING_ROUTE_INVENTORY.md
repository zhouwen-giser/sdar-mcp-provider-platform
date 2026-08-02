# Existing Route Inventory

These routes are the current SMPP transport evidence. The Console contract defines a separate future adapter under `/api/console/v1`; this task does not implement it.

| Method | Current route                                                              | Existing service/query                            | Console candidate operation     |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| GET    | `/api/v1/provider-packages`                                                | `ProviderPackageQueryService.list`                | `listProviderPackages`          |
| GET    | `/api/v1/provider-packages/:packageId`                                     | `ProviderPackageQueryService.get`                 | `getProviderPackage`            |
| GET    | `/api/v1/provider-types`                                                   | `ProviderManagementService.listProviderTypes`     | `listProviderTypes`             |
| GET    | `/api/v1/provider-types/:providerTypeId`                                   | `ProviderManagementService.getProviderType`       | `getProviderType`               |
| GET    | `/api/v1/providers`                                                        | `ProviderManagementService.listProviders`         | `listProviders`                 |
| POST   | `/api/v1/providers`                                                        | `ProviderManagementService.createProvider`        | `createProvider`                |
| GET    | `/api/v1/providers/:providerId`                                            | `ProviderManagementService.getProvider`           | `getProvider`                   |
| PATCH  | `/api/v1/providers/:providerId/status`                                     | `ProviderManagementService.updateProviderStatus`  | `updateProviderStatus`          |
| GET    | `/api/v1/resources`                                                        | `ProviderManagementService.listResources`         | `listResources`                 |
| POST   | `/api/v1/resources`                                                        | `ProviderManagementService.createResource`        | `createResource`                |
| GET    | `/api/v1/resources/:environment/:resourceId`                               | `ProviderManagementService.getResource`           | `getResource`                   |
| PATCH  | `/api/v1/resources/:environment/:resourceId/status`                        | `ProviderManagementService.updateResourceStatus`  | `updateResourceStatus`          |
| GET    | `/api/v1/providers/:providerId/resource-bindings`                          | `ProviderManagementService.listProviderResources` | `listProviderResourceBindings`  |
| POST   | `/api/v1/providers/:providerId/resource-bindings`                          | `ProviderManagementService.bindResource`          | `bindProviderResource`          |
| DELETE | `/api/v1/providers/:providerId/resource-bindings/:environment/:resourceId` | `ProviderManagementService.unbindResource`        | `unbindProviderResource`        |
| POST   | `/api/v1/config-drafts`                                                    | `ConfigurationCenter.createDraft`                 | `createConfigurationDraft`      |
| GET    | `/api/v1/config-drafts/:draftId`                                           | `ConfigurationCenter.getDraft`                    | `getConfigurationDraft`         |
| PATCH  | `/api/v1/config-drafts/:draftId`                                           | `ConfigurationCenter.updateDraft`                 | `updateConfigurationDraft`      |
| POST   | `/api/v1/config-drafts/:draftId/validate`                                  | `ConfigurationCenter.validateDraft`               | `validateConfigurationDraft`    |
| GET    | `/api/v1/config-drafts/:draftId/effective`                                 | `ConfigurationCenter.effectivePreview`            | `previewEffectiveConfiguration` |
| POST   | `/api/v1/config-drafts/:draftId/publish`                                   | `ConfigurationPublicationService.publish`         | `publishConfigurationDraft`     |
| POST   | `/api/v1/config-drafts/:draftId/rollback`                                  | `ConfigurationPublicationService.rollback`        | `rollbackConfigurationDraft`    |
| GET    | `/api/v1/runtime-deployments`                                              | `RuntimeDeploymentManagementPort.list`            | `listRuntimeDeployments`        |
| POST   | `/api/v1/runtime-deployments`                                              | `RuntimeDeploymentApplicationService.create`      | `createRuntimeDeployment`       |
| GET    | `/api/v1/runtime-deployments/:deploymentId`                                | `RuntimeDeploymentManagementPort.get`             | `getRuntimeDeployment`          |
| POST   | `/api/v1/runtime-deployments/:deploymentId/start`                          | `RuntimeDeploymentApplicationService.command`     | `startRuntimeDeployment`        |
| POST   | `/api/v1/runtime-deployments/:deploymentId/stop`                           | `RuntimeDeploymentApplicationService.command`     | `stopRuntimeDeployment`         |
| POST   | `/api/v1/runtime-deployments/:deploymentId/restart`                        | `RuntimeDeploymentApplicationService.command`     | `restartRuntimeDeployment`      |
| POST   | `/api/v1/runtime-deployments/:deploymentId/scale`                          | `RuntimeDeploymentApplicationService.command`     | `scaleRuntimeDeployment`        |
| POST   | `/api/v1/runtime-deployments/:deploymentId/reconcile`                      | `RuntimeDeploymentApplicationService.command`     | `reconcileRuntimeDeployment`    |
| GET    | `/api/v1/runtime-processes`                                                | `RuntimeProcessQueryService.list`                 | `listRuntimeProcesses`          |
| GET    | `/api/v1/runtime-processes/:instanceId`                                    | `RuntimeProcessQueryService.get`                  | `getRuntimeProcess`             |
| GET    | `/api/v1/registry/:environment/latest`                                     | `RegistrySnapshotRepository.latest`               | `getLatestRegistrySnapshot`     |
| GET    | `/api/v1/registry/:environment/history`                                    | `RegistrySnapshotRepository.history`              | `listRegistryHistory`           |
| GET    | `/api/v1/registry/:environment/diff`                                       | `RegistrySnapshotRepository.diff`                 | `diffRegistrySnapshots`         |
| GET    | `/api/v1/audit-events`                                                     | `AuditRepository.list`                            | `listAuditEvents`               |

The existing Runtime process `/logs` route only returns an opaque reference. No standalone Console log-reference operation is included. Runtime registration, Runtime Config machine endpoints, health probes, Registry bootstrap/watch and raw OpenAPI discovery remain outside the Console contract.
