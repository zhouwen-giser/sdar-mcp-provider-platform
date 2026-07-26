# Home Assistant Climate Provider Frozen Protocol V1 Migration Report

Date: 2026-07-19

Branch: `feature/home-assistant-climate-provider`

Runtime baseline: merge commit `798656827ea747fb824df2975f8e66135e80fcc2`

## Result

The branch normally merges the protected Runtime migration from `origin/main` and consumes the
shared frozen MCP Stateless 2026-07-28 and SEP-2663 implementation. It does not copy or fork the
Runtime protocol handler.

The Provider retains the existing operation names because no frozen SDAR Skill Catalog was
provided:

- `climate_get_state` maps to `synchronous_only`.
- `climate_set_power`, `climate_set_hvac_mode`, and `climate_set_temperature` map to
  `task_required`.

Control completion persists the actual normalized Home Assistant state that confirmed the desired
effect. The terminal Adapter snapshot derives both `structuredContent` and type-only Evidence
from that observation. Power Evidence points to `/power`; HVAC mode Evidence points to `/hvacMode`; target-temperature
Evidence points to `/targetTemperature`. Provider source and Wire output contain no `requirementId`.

## Frozen E2E

The Provider-specific E2E uses real Runtime HTTP/SSE and PostgreSQL with Fake Home Assistant:

1. `server/discover` and `tools/list` use frozen request meta and routing headers.
2. synchronous state reads return `resultType=complete` with observed Evidence.
3. control returns a flat `CreateTaskResult`.
4. `subscriptions/listen` acknowledges first and emits working then completed snapshots.
5. the completed notification equals authoritative `tasks/get` at the same Runtime Revision after
   removing transport-only notification metadata.
6. retrying the same idempotency key returns the same Task and does not repeat the Home Assistant
   side effect.

## Claim boundary

Machine evidence is in `provider-conformance.json` and is locked to the SHA-256 of the tested
Provider source and E2E files. The maximum claim is **Home Assistant Climate Provider Component
Conformant**. Fake Home Assistant is not a physical device or independently managed deployment, so
this work does not claim `real-resource qualified` or `Interop Certified`.
