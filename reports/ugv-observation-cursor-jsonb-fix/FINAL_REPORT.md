# UGV Observation Cursor JSONB Fix — Final Report

## Result

`UGV_OBSERVATION_CURSOR_JSONB_FIX_QUALIFIED`

## Baseline

The target branch was created from remote source SHA `32f338a844587fd137c606663154d08b9fe96f53`. The reviewed Ingress, UGV Runtime and PostgreSQL Store blobs matched the task package exactly.

## Root cause confirmation

Topic and Field Observation Cursors contained U+0000 delimiters. The full ProviderExecution was passed to PostgreSQL as JSONB before any Device MCP mutation, and PostgreSQL rejected the Cursor string.

## Changes

- Added one shared `ObservationCursorCodecV1` using `oc1.<base64url(canonical-json)>`.
- Migrated Topic and Field Cursor producers to the shared codec.
- Removed UGV and NPC Runtime delimiter parsing; explicit Observation Authority timestamps are authoritative.
- Added fail-closed JSONB safety diagnostics without raw payload values.
- Preserved legacy safe opaque Cursor equality behavior.

## PostgreSQL proof

An actual `VehicleMqttIngress` baseline and ProviderExecution were persisted to and read from PostgreSQL 17. Cursor bytes and authority metadata survived unchanged. A negative NUL payload was rejected as `PROVIDER_STORE_JSONB_UNSAFE_PAYLOAD` before SQL execution.

## Navigation startup proof

The real PostgreSQL Store, real Ingress, UGV Runtime and Fake Device MCP produced exactly one `ugv_path_follow_mission` and one `ugv_mission_control(start)` call. The mission ID and both accepted Mutation Journal entries were durable.

## Side-effect ordering proof

Observed order was Execution persistence, primary intent, primary dispatch, mission-ID persistence, follow-up intent and follow-up dispatch. Initial Execution persistence failure produced zero journals, zero device calls and released the chassis track.

## Restart/recovery proof

After closing and reopening the Store and Runtime, the non-terminal Execution and both accepted journal records were recovered without primary or follow-up redispatch.

## Shared regression

Focused UGV/NPC/shared regression passed 50 files and 309 tests. PostgreSQL regression passed 2 files and 4 tests. Formatting, ESLint, typecheck, build and frozen protocol checks passed.

## Compatibility

- Protocol changes: none.
- Database migrations: none.
- Real control executed: false.
- New dependencies: none.

## Deferred follow-ups

The local Mock MQTT publisher's fixed position behavior remains intentionally out of scope.

## Delivery artifacts

The delivery directory contains a ZIP, SHA-256 sidecar and patch generated after this report commit.
