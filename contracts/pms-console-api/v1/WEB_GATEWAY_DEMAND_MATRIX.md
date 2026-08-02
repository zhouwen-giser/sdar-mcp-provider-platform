# PMS Web Gateway Demand Matrix

The terms below describe the current Candidate. They do not claim that PMS Web or PMS API is conformant.

| Gateway method                                  | Classification    | Contract treatment                                                          |
| ----------------------------------------------- | ----------------- | --------------------------------------------------------------------------- |
| `DashboardGateway.dashboard`                    | WEB_COMPOSED      | Aggregate candidate list endpoints in Web; no Dashboard domain.             |
| `ProviderGateway.providers`                     | CANDIDATE_API     | `listProviders`                                                             |
| `ProviderGateway.provider`                      | CANDIDATE_API     | `getProvider`                                                               |
| `ProviderGateway.onboardProvider`               | WEB_COMPOSED      | Existing create/bind/deployment/config calls; no onboarding endpoint.       |
| `ResourceGateway.resources`                     | CANDIDATE_API     | `listResources`                                                             |
| `RuntimeGateway.deployments`                    | CANDIDATE_API     | `listRuntimeDeployments`                                                    |
| `RuntimeGateway.deployment`                     | CANDIDATE_API     | `getRuntimeDeployment`                                                      |
| `RuntimeGateway.runtimeProcesses`               | CANDIDATE_API     | `listRuntimeProcesses`                                                      |
| `RuntimeGateway.createRuntimeDeployment`        | CANDIDATE_API     | `createRuntimeDeployment`                                                   |
| `RuntimeGateway.reconcileRuntime`               | CANDIDATE_API     | `reconcileRuntimeDeployment`                                                |
| `ConfigurationGateway.configurationProfiles`    | MOCK_DEFERRED     | `ConfigurationProfile` is a Web ViewModel, not a SMPP object.               |
| `ConfigurationGateway.runtimeConfigurationAcks` | MOCK_DEFERRED     | No reviewed Console management query.                                       |
| `ConfigurationGateway.publishConfiguration`     | WEB_COMPOSED      | Existing create/update/validate/publish or rollback operations.             |
| `CatalogGateway.catalogOperations`              | MOCK_DEFERRED     | No stable Console Catalog query route is frozen.                            |
| `CatalogGateway.rediscoverCatalog`              | FORBIDDEN         | Rediscovery remains RuntimeDeployment reconciliation behavior.              |
| `CatalogGateway.publishCatalog`                 | FORBIDDEN         | No manual Catalog publication command.                                      |
| `RegistryGateway.registryRevisions`             | CANDIDATE_API     | latest/history/diff Registry operations.                                    |
| `OperationsGateway.jobs`                        | MOCK_DEFERRED     | No reviewed management query route.                                         |
| `OperationsGateway.incidents`                   | MOCK_DEFERRED     | No Incident domain.                                                         |
| `OperationsGateway.operations`                  | MOCK_DEFERRED     | `PrototypeOperation` remains UI-only.                                       |
| `OperationsGateway.startOperation`              | FORBIDDEN         | No Generic Operation command or state machine.                              |
| `OperationsGateway.advanceOperation`            | FORBIDDEN         | No Generic Operation state machine.                                         |
| `OperationsGateway.requeueJob`                  | MOCK_DEFERRED     | No reviewed management service.                                             |
| `OperationsGateway.closeIncident`               | MOCK_DEFERRED     | No Incident domain.                                                         |
| `AuditGateway.auditEvents`                      | CANDIDATE_API     | `listAuditEvents`; Audit detail remains deferred.                           |
| Login/auth/session gateways                     | CONTRACT_DEFERRED | Authentication, authorization, RBAC, login and sessions are not part of V1. |
