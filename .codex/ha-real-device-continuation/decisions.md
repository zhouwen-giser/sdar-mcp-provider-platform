# Continuation decisions

## C0-D001 Candidate protection

Continue from the existing `codex/ha-real-device-preparation` lineage. The previous candidate and base are ancestors of the current HEAD; no checkout reset or broad rewrite is allowed.

## C1-D002 Frozen Tasks terminal authority

The frozen MCP profile does not expose `tasks/result`. Real runners and reports use terminal `tasks/get`/notifications and must not add or call the removed method. The C1 regression evidence closes the runner-mismatch blocker without changing the frozen profile.

## C2-D003 Cross-platform evidence

Do not overwrite the frozen protocol lock with Windows-derived hashes. Produce per-file line-ending evidence first, then validate Linux and Windows independently. The lock now verifies 38/38 on both platforms; the Linux symlink branch is exercised by a dedicated gate because the host Windows dependency tree cannot provide Linux native optional bindings.

## C3-D004 PMS authority

Formal Provider, Resource, Deployment, Catalog, and Registry state must be created through the real PMS API/application service, not direct database writes or fake PMS fixtures.

## C9-D005 Climate power safety

`climate_set_power` may run only with its explicit safety gate, a unique run ID, no active/uncertain climate task, and the five-minute opposite-power protection. If unavailable, record deferred and keep full-capability readiness false.

## C6-D006 Registry-backed evidence

The PMS Registry is the endpoint source of truth for the live device drivers. Runtime endpoints copied from local process configuration are not sufficient; every current E2E report records Registry revision, checksum, provider IDs, endpoint, and sensitive-field checks.

## C7-D007 Recovery classification

An Adapter restart that requires a Runtime restart is recorded as partial recovery, not automatic reconnection. Do not claim in-flight Task recovery until a bounded real Task is observed across the interruption with no duplicate Home Assistant side effect.

## C9-D008 Climate safety stop

When the saved climate power is off, skip HVAC and power writes if a safe inverse operation cannot be performed inside the five-minute protection window. Preserve the original/current state and keep `readyForSdarIntegration` false.
- 2026-08-03 C10: classify the repository result as `partial`, not passed. Direct component gates pass, but repository-wide formatting, Windows EPERM cases, and aggregate verify wrappers keep the hard completion gate open.
- 2026-08-03 C11: handoff readiness remains false. Only the two configured lights are listed as realResourcesQualified; the climate is read-only and manually safety-blocked. No Provider Package realResourceStatus is expanded.
