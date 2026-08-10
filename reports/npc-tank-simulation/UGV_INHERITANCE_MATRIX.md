# Goal 10 UGV → Goal 11 NPC Tank inheritance matrix

Status: `PASS`

Goal 10 selected base: `ac3369ba9fa4e0ff6b6589525594b50291da02b7`

Pre-Goal-10 comparison base: `981792b9cb22f8b3117fe3ab26f639de71487d1f`

## Decision

The old NPC implementation is not the target architecture. Goal 11 will use the final Goal 10 shared transport, normalization, task lifecycle, recovery, Provider surface, packaging, and PMS patterns, with only NPC identity, capability defaults, tool/argument mapping, and topic mapping kept profile-specific.

The machine-readable matrix contains 32 classified features:

| Classification                 | Count | Meaning for Goal 11                                                                             |
| ------------------------------ | ----: | ----------------------------------------------------------------------------------------------- |
| `SHARED_REUSE`                 |    20 | Reuse or carefully generalize Goal 10 behavior with UGV regression.                             |
| `NPC_PROFILE_CONFIGURATION`    |     7 | Supply NPC identity, safety defaults, topic/QoS inventory, capabilities, and persistence scope. |
| `NPC_SPECIFIC_MAPPING`         |     3 | Map standard Provider semantics into real `npc_tank_*` tools/topics.                            |
| `NOT_APPLICABLE`               |     1 | Do not retain the legacy EO scan trio when the canonical circular-recon flow is available.      |
| `UGV_ONLY_EXTERNAL_CAPABILITY` |     1 | Report a missing real NPC external capability instead of fabricating it.                        |

## Mandatory shared reuse

- Streamable HTTP connection, `tools/list`, contract hashing, bounded responses, and no-Mock gate;
- structured downstream result validation, non-zero `error_code` rejection, integer mission-ID chaining, read retry, uncertain-write no-retry, and per-tool circuit recovery;
- exact MQTT subscriptions, validated SUBACK readiness, explicit wire mode, payload guards, identity validation, duplicate/older/stale rejection, and reconnect/resubscribe;
- independent chassis `MissionState` and recon `MotionStatus`, rich recon/target normalization, `cameraFault`, `outOfRange`, coverage authority, and empty target clearing;
- standard vehicle operations, including `vehicle_get_capabilities` and `vehicle_control_gimbal` when the captured contract supports them;
- serialized mutations, post-dispatch observation cursors, idempotent task replay, identity conflicts, and restart reconciliation;
- Provider business events, telemetry redaction, exact-HEAD images, PMS Console layering, and Registry authority.

## Required generalization

Current shared code still contains UGV-only branches for modern MQTT target authority and camera-fault/recon state preservation. These branches must become vehicle-profile behavior so NPC reuses the same semantics without changing UGV output.

The current NPC runtime is a separate legacy lifecycle. Goal 11 must not merely add missing branches to it; lifecycle helpers or the execution engine must be shared with the final UGV behavior, with NPC-specific downstream calls injected through a profile.

## NPC-specific boundary

Real `tools/list` and passive MQTT capture will decide the exact allowlist, status aliases, schemas, QoS observations, and explicit wire mode. Human documentation predicts a 15-tool UGV-symmetric surface, `need_plan=false`, circular recon through `scan_mode=2`, combined lock/unlock, and manual yaw-only sweep, but none of those predictions will be promoted to real evidence before capture.

No real NPC endpoint was accessed, and no movement, reconnaissance, effector, or MQTT publish action was attempted while producing this matrix.
