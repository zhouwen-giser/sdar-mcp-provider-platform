# PMS Console API V1 Error Catalog

The Console transport uses `application/problem+json` to project existing public SMPP errors. Authentication and authorization errors are out of scope for V1. No retryability policy is frozen.

| Code                                              | HTTP | Existing source                                   |
| ------------------------------------------------- | ---: | ------------------------------------------------- |
| `INVALID_REQUEST`                                 |  400 | `INVALID_REQUEST`                                 |
| `INVALID_JSON`                                    |  400 | `INVALID_JSON`                                    |
| `REQUEST_BODY_TOO_LARGE`                          |  413 | `REQUEST_BODY_TOO_LARGE`                          |
| `INTERNAL_ERROR`                                  |  500 | `INTERNAL_ERROR`                                  |
| `ROUTE_NOT_FOUND`                                 |  404 | `ROUTE_NOT_FOUND`                                 |
| `INVALID_IDENTIFIER`                              |  400 | `INVALID_IDENTIFIER`                              |
| `INVALID_DOMAIN_VALUE`                            |  400 | `INVALID_DOMAIN_VALUE`                            |
| `INVALID_STATE_TRANSITION`                        |  400 | `INVALID_STATE_TRANSITION`                        |
| `DUPLICATE_RESOURCE_BINDING`                      |  400 | `DUPLICATE_RESOURCE_BINDING`                      |
| `RESOURCE_BINDING_NOT_FOUND`                      |  404 | `RESOURCE_BINDING_NOT_FOUND`                      |
| `ENTITY_ALREADY_EXISTS`                           |  409 | `ENTITY_ALREADY_EXISTS`                           |
| `ENTITY_NOT_FOUND`                                |  404 | `ENTITY_NOT_FOUND`                                |
| `OPTIMISTIC_CONCURRENCY_CONFLICT`                 |  409 | `OPTIMISTIC_CONCURRENCY_CONFLICT`                 |
| `LEASE_NOT_OWNED`                                 |  409 | `LEASE_NOT_OWNED`                                 |
| `RUNTIME_DEPLOYMENT_NOT_FOUND`                    |  404 | `RUNTIME_DEPLOYMENT_NOT_FOUND`                    |
| `RUNTIME_DEPLOYMENT_PROVIDER_UNAVAILABLE`         |  409 | `RUNTIME_DEPLOYMENT_PROVIDER_UNAVAILABLE`         |
| `RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE`   |  409 | `RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE`   |
| `RUNTIME_DEPLOYMENT_DATABASE_PROFILE_UNAVAILABLE` |  409 | `RUNTIME_DEPLOYMENT_DATABASE_PROFILE_UNAVAILABLE` |
| `RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED`    |  400 | `RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED`    |
| `RUNTIME_DEPLOYMENT_REVISION_CONFLICT`            |  409 | `RUNTIME_DEPLOYMENT_REVISION_CONFLICT`            |
| `RUNTIME_PROCESS_NOT_FOUND`                       |  404 | `RUNTIME_PROCESS_NOT_FOUND`                       |
| `CONFIGURATION_DEFINITION_NOT_FOUND`              |  404 | `CONFIGURATION_DEFINITION_NOT_FOUND`              |
| `CONFIGURATION_TARGET_NOT_ALLOWED`                |  400 | `CONFIGURATION_TARGET_NOT_ALLOWED`                |
| `CONFIGURATION_BUSINESS_KEY_CONFLICT`             |  409 | `CONFIGURATION_BUSINESS_KEY_CONFLICT`             |
| `CONFIGURATION_DRAFT_NOT_FOUND`                   |  404 | `CONFIGURATION_DRAFT_NOT_FOUND`                   |
| `CONFIGURATION_DRAFT_VERSION_CONFLICT`            |  409 | `CONFIGURATION_DRAFT_VERSION_CONFLICT`            |
| `CONFIGURATION_DRAFT_NOT_VALIDATED`               |  409 | `CONFIGURATION_DRAFT_NOT_VALIDATED`               |
| `CONFIGURATION_PUBLISH_CONFLICT`                  |  409 | `CONFIGURATION_PUBLISH_CONFLICT`                  |
| `CONFIGURATION_REVISION_NOT_FOUND`                |  404 | `CONFIGURATION_REVISION_NOT_FOUND`                |
| `CONFIGURATION_ROLLBACK_TARGET_MISMATCH`          |  400 | `CONFIGURATION_ROLLBACK_TARGET_MISMATCH`          |
| `CONFIGURATION_INPUT_INVALID`                     |  400 | `CONFIGURATION_INPUT_INVALID`                     |
| `REGISTRY_SNAPSHOT_NOT_FOUND`                     |  404 | `REGISTRY_SNAPSHOT_NOT_FOUND`                     |
