# Interaction Inventory

## Executable frozen mutations

- Provider create and status transition, using `expectedUpdatedAt` where required.
- Resource create, bind, unbind, and status transition, preserving optimistic concurrency.
- RuntimeDeployment create/start/stop/restart/scale/reconcile, preserving `expectedDesiredRevision` and `desiredReplicas ∈ {0,1}`.
- Configuration Draft create/update/validate/publish/rollback, preserving `expectedVersion`, `expectedPublishedRevision`, and `sourceRevisionId`.

## Web-composed interactions

- Provider onboarding and RuntimeDeployment creation wizards compose existing queries and exactly one frozen mutation at submission.
- Dashboard, Attention, Search, Runtime Instance, Catalog revision views, Operation panels, and detail projections combine existing domain queries without creating backend state.

## Client-only interactions

- Notifications, Incident workspace, Change Request review, local Conformance/MCP analysis, Audit export, preferences, access/settings prototypes, local comparison, and table/filter state.

## High-risk controls

Provider retirement, Resource unbinding, Runtime stop/restart/scale-to-zero, Configuration publish, and rollback use explicit impact descriptions, confirmation state, concurrency metadata, duplicate-submit prevention, and mutation feedback.
