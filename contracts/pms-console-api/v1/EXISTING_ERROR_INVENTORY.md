# Existing Error Inventory

The normative inventory is `ERROR_SOURCE_MAP.json`. It is derived from `apps/pms-api/src/errors.ts`, existing domain/application error unions and the existing Registry not-found response. Authentication and authorization errors are deliberately excluded from V1 because those features are deferred. No Console-only business error or retryability policy is introduced.
