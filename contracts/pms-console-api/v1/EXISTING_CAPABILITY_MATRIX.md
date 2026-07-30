# Existing Capability Matrix

| Object                   | Operation                       | Classification   | Candidate disposition | Existing evidence                                 |
| ------------------------ | ------------------------------- | ---------------- | --------------------- | ------------------------------------------------- |
| ProviderPackage          | `listProviderPackages`          | EXISTING_QUERY   | Candidate API         | `ProviderPackageQueryService.list`                |
| ProviderPackage          | `getProviderPackage`            | EXISTING_QUERY   | Candidate API         | `ProviderPackageQueryService.get`                 |
| ProviderType             | `listProviderTypes`             | EXISTING_QUERY   | Candidate API         | `ProviderManagementService.listProviderTypes`     |
| ProviderType             | `getProviderType`               | EXISTING_QUERY   | Candidate API         | `ProviderManagementService.getProviderType`       |
| Provider                 | `listProviders`                 | EXISTING_QUERY   | Candidate API         | `ProviderManagementService.listProviders`         |
| Provider                 | `createProvider`                | EXISTING_COMMAND | Candidate API         | `ProviderManagementService.createProvider`        |
| Provider                 | `getProvider`                   | EXISTING_QUERY   | Candidate API         | `ProviderManagementService.getProvider`           |
| Provider                 | `updateProviderStatus`          | EXISTING_COMMAND | Candidate API         | `ProviderManagementService.updateProviderStatus`  |
| Resource                 | `listResources`                 | EXISTING_QUERY   | Candidate API         | `ProviderManagementService.listResources`         |
| Resource                 | `createResource`                | EXISTING_COMMAND | Candidate API         | `ProviderManagementService.createResource`        |
| Resource                 | `getResource`                   | EXISTING_QUERY   | Candidate API         | `ProviderManagementService.getResource`           |
| Resource                 | `updateResourceStatus`          | EXISTING_COMMAND | Candidate API         | `ProviderManagementService.updateResourceStatus`  |
| ProviderResourceBinding  | `listProviderResourceBindings`  | EXISTING_QUERY   | Candidate API         | `ProviderManagementService.listProviderResources` |
| ProviderResourceBinding  | `bindProviderResource`          | EXISTING_COMMAND | Candidate API         | `ProviderManagementService.bindResource`          |
| ProviderResourceBinding  | `unbindProviderResource`        | EXISTING_COMMAND | Candidate API         | `ProviderManagementService.unbindResource`        |
| ConfigurationDraft       | `createConfigurationDraft`      | EXISTING_COMMAND | Candidate API         | `ConfigurationCenter.createDraft`                 |
| ConfigurationDraft       | `getConfigurationDraft`         | EXISTING_QUERY   | Candidate API         | `ConfigurationCenter.getDraft`                    |
| ConfigurationDraft       | `updateConfigurationDraft`      | EXISTING_COMMAND | Candidate API         | `ConfigurationCenter.updateDraft`                 |
| ConfigurationDraft       | `validateConfigurationDraft`    | EXISTING_COMMAND | Candidate API         | `ConfigurationCenter.validateDraft`               |
| EffectiveConfiguration   | `previewEffectiveConfiguration` | EXISTING_QUERY   | Candidate API         | `ConfigurationCenter.effectivePreview`            |
| ConfigurationPublication | `publishConfigurationDraft`     | EXISTING_COMMAND | Candidate API         | `ConfigurationPublicationService.publish`         |
| ConfigurationPublication | `rollbackConfigurationDraft`    | EXISTING_COMMAND | Candidate API         | `ConfigurationPublicationService.rollback`        |
| RuntimeDeployment        | `listRuntimeDeployments`        | EXISTING_QUERY   | Candidate API         | `RuntimeDeploymentManagementPort.list`            |
| RuntimeDeployment        | `createRuntimeDeployment`       | EXISTING_COMMAND | Candidate API         | `RuntimeDeploymentApplicationService.create`      |
| RuntimeDeployment        | `getRuntimeDeployment`          | EXISTING_QUERY   | Candidate API         | `RuntimeDeploymentManagementPort.get`             |
| RuntimeDeployment        | `startRuntimeDeployment`        | EXISTING_COMMAND | Candidate API         | `RuntimeDeploymentApplicationService.command`     |
| RuntimeDeployment        | `stopRuntimeDeployment`         | EXISTING_COMMAND | Candidate API         | `RuntimeDeploymentApplicationService.command`     |
| RuntimeDeployment        | `restartRuntimeDeployment`      | EXISTING_COMMAND | Candidate API         | `RuntimeDeploymentApplicationService.command`     |
| RuntimeDeployment        | `scaleRuntimeDeployment`        | EXISTING_COMMAND | Candidate API         | `RuntimeDeploymentApplicationService.command`     |
| RuntimeDeployment        | `reconcileRuntimeDeployment`    | EXISTING_COMMAND | Candidate API         | `RuntimeDeploymentApplicationService.command`     |
| RuntimeProcess           | `listRuntimeProcesses`          | EXISTING_QUERY   | Candidate API         | `RuntimeProcessQueryService.list`                 |
| RuntimeProcess           | `getRuntimeProcess`             | EXISTING_QUERY   | Candidate API         | `RuntimeProcessQueryService.get`                  |
| RegistrySnapshot         | `getLatestRegistrySnapshot`     | EXISTING_QUERY   | Candidate API         | `RegistrySnapshotRepository.latest`               |
| RegistrySnapshot         | `listRegistryHistory`           | EXISTING_QUERY   | Candidate API         | `RegistrySnapshotRepository.history`              |
| RegistrySnapshot         | `diffRegistrySnapshots`         | EXISTING_QUERY   | Candidate API         | `RegistrySnapshotRepository.diff`                 |
| AuditEvent               | `listAuditEvents`               | EXISTING_QUERY   | Candidate API         | `AuditRepository.list`                            |
