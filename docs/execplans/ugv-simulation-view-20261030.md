# Project-owned simulation view adjustment

## Purpose / Outcome

Implement a real simulation FOV backend in this repository and publish a distinct MCP task tool.
The user clarified “在本项目中扩展实现”. Preserve completed timeout/diagnostic/admission fixes
in d2a03f7. Work only in the existing isolated SMPP checkout.

## Requirements Covered

Real simulation view adjustment, explicit camera ownership and actual FOV/frame evidence;
versioned exact catalog; task identity, confirmation, durable commands and no uncertain replay;
operation-specific admission and Chinese panel. Preserve frozen MCP and old catalogs/results.

## Context and Orientation

EO V2.2 has no implemented FOV endpoint; optical zoom is rejected. CARLA RPC is reachable at
192.168.2.63:2000. Official client 0.9.15 reports custom server 067529e82-dirty. Read-only
compatibility and actor identity must be recorded separately from mutation acceptance.
The old explicit scope disallowed changes to upstream services. The backend therefore lives
here and manages a project-owned simulation camera; it cannot claim to change upstream EO
recognition or calibration. This interpretation has been presented as an optional scope choice.

## Architecture and Interfaces

- Add local authenticated simulation-view gateway using official pinned CARLA Python API.
  Server configuration fixes host, exact server/world/parent identity, project ownership,
  transform, resolution and supported horizontal FOV range. No browser-supplied upstream URL.
- Only mutate project-owned RGB cameras. A task may create/recreate the project's view; retain
  the old view until a new camera and post-request image prove the change. Never destroy an
  externally owned camera or advance the simulator clock.
- Persist an intent before any spawn, exact input hash and immutable per-command receipt.
  Duplicate command IDs return previous facts; unknown attempts are queried, never replayed.
  Restart does not create cameras. Result requires actual attributes and new frame evidence.
- Publish simulation_adjust_view in independent 1.4.0 / zmq_v1_4_0_site_control_14 catalog.
  Existing thirteen operations retain their exact predecessor input contracts. New task is
  side-effecting, scheduling/deadline aware, no pause/resume or automatic rollback.
- Reuse native engine EO serialization, leases, TaskBusiness and JSONB; separate view protocol
  from frozen TeleControl. New result explicitly identifies project-owned simulation view.
- Display horizontal FOV in degrees and source in Chinese, with verified report/image evidence.
  Missing backend/source mapping is disabled with a specific reason.
- SDAR is outside this clarification's project scope. Old exact SDAR bindings reject the new
  profile until a separately governed follow-up; no existing bindings are silently broadened.

## Progress

- [x] 2026-10-30 Record clarified project scope, inspect official CARLA API and read-only endpoint.
- [x] 2026-10-30 Implement authenticated project-owned camera backend; 11 Python tests pass.
- [x] 2026-10-30 Add exact 14-tool catalog, task engine integration and admission; 7 contract/PG/MCP cases pass.
- [x] 2026-10-30 Add Chinese acknowledgement/FOV/report/thumbnail UI and deployment docs; browser case passes.
- [ ] Run isolated native/PostgreSQL/MCP/browser tests and full project gate.
- [ ] Record read-only site compatibility, candidate artifacts, commit and push.

## Discoveries and Surprises

The CARLA server is a custom build. TCP connectivity is insufficient to qualify a camera or
assert that a matching SDK is available. No upstream source exists at the documentation's
relative ros_ws links on this host. Optical zoom rejection remains valid.

## Decision Log

Use a project-owned camera with an explicit source label. Camera recreation changes its own
intrinsics; derive and label calibration from actual CARLA attributes. Do not present it as
measured geolocation or feed it into the existing EO detection stream.

## Implementation Steps

Build the local camera service first, then its typed gateway/contract, engine integration,
fourteen-tool manifest and console. Reuse existing storage and control admission. Configuration
is opt-in and requires exact mapping; formal readonly remains until candidate verification.

## Validation

Cover real backend code with an isolated CARLA API double, real HTTP auth and native/MCP/PG
task chain. Include actual-vs-requested FOV conflict, stale/new frames, duplicate/cross-command
requests, process restart, timeout/cancel uncertainty, ownership checks and no upstream camera
mutation. Full gate includes Python tests plus prior 21 checks; preserve all exit codes/hashes.
Read-only site probes may list identity and attributes. Camera creation/recreation is a separate
operator-confirmed field acceptance, not implied by a successful software fixture.

## Idempotence and Recovery

Durable command receipts precede side effects. Do not replay attempted changes after failure.
Keep old camera until new evidence. Unknown results retain occupancy and require query or
existing audited reconciliation. Rollback to anonymous readonly preserves all history.

## Artifacts and Evidence

External evidence: /mnt/data/ugv-zmq-view-diagnostics-20261029. SDK wheel SHA256:
61449e33260f6a0cfd2f88d56f2463a5797a0b51bc46618beec07365422d4ad6.
Official references: https://carla.readthedocs.io/en/0.9.15/core_sensors/ and
https://carla.readthedocs.io/en/0.9.15/python_api/ . No upstream source copied.

## Outcomes and Retrospective

In progress. Local fixes are software verified; no simulation-view tool is published yet.
The first GitHub push timed out because local DNS returned an unreachable fake address. Using a
verified current public DNS result for this Git command only, d2a03f7 is now pushed and the remote
branch was independently verified. No host DNS or global Git configuration was changed.

Final source gate is running with 24 checks, adding backend Python, exact v14 catalog and browser
checks to the earlier 21. No source files change during that run. Gateway Docker build succeeds;
its pinned official SDK 0.9.16 imports under network isolation. Final images will be rebuilt with
the frozen code commit label. Site probe returns client 0.9.16 versus server 067529e82-dirty;
only version queries were issued. The matching SDK and actual vehicle/world mapping remain
external prerequisites. No site camera was created or destroyed and no upstream code was changed.

An initial browser failure caught the missing console control allowlist entry; it is fixed.
The next test was corrected to open the task record before expecting its report, following the
existing UI flow. Initial integration tests also caught TaskBusiness registration for the new
tool. Those failures were not hidden or converted into weaker assertions. Field qualification
still remains separate from the clearly marked CARLA API double used by software tests.
