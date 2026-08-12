# Goal 10 PMS Console addendum — known limitations

Qualification HEAD: `7ca09d55aaf01dab9d6711fdd793530084897868`

The following limitations do not block the PMS Console packaging gates covered by this addendum.

## External UGV protocol drift

- The current exact-HEAD preflight reached the real Device MCP and found all 15 expected tools. It also connected to MQTT in passive-subscription mode without publishing. However, the canonical composite topic `status/ugv` was not observed; the live simulator emitted the supported compatibility alias `/ugv/status`.
- The live `/ugv/speed` publisher delivered QoS 0 while the supplied protocol expects QoS 1. This is an upstream publisher mismatch, so the integrated preflight is accurately classified `PASS_WITH_UPSTREAM_DRIFT` and the broader UGV simulation qualification remains partial. It does not invalidate the PMS Console package or Compose integration.

No real endpoint or credential value is retained in addendum evidence.

## Safety-bounded qualification

- The integrated smoke called only `vehicle_get_state`, `vehicle_get_capabilities`, `vehicle_get_payload_status`, and `vehicle_get_targets`. All four passed. `controlAttempted` is false and `mutatingToolCalls` is 0.
- No movement, point/route navigation, reconnaissance, gimbal, target-lock, or effector action was attempted. MQTT was never published to. This is the required safety boundary, not evidence that those real control paths were qualified.
- The Worker was packaged and ran healthy, including the executable `2.0.0-rc.1` Runtime release and protected state roots. The `job_lease` table remained empty before and after qualification, so no asynchronous deployment or Runtime-control job was exercised against the real UGV stack.

## Fresh-deployment command audit

The safety approval layer declined the requested literal `bash deploy/pms-console/down.sh --volumes` invocation. Read-only inventory immediately beforehand proved there were zero matching project containers and zero matching named volumes, so there was nothing for that destructive command to remove and the first `up.sh` still started from a genuinely empty project state. Automatic and explicit smoke checks passed from that state. A subsequent non-destructive `down.sh`, volume-preserving `up.sh`, automatic smoke, and explicit smoke also passed.

If an auditor requires the literal volume-deletion command rather than direct proof of its empty-state postcondition, it must be rerun with operator approval in a disposable environment.

## Evidence-generation ordering

The exact-HEAD integrated `up.sh` and explicit `smoke.sh` qualification both passed before the addendum evidence files were generated. A later convenience replay of `smoke.sh` without a process-level secret-root override stopped at `QUALIFICATION_SOURCE_TREE_DIRTY`: the newly generated, intentionally uncommitted files under `reports/goal-10-pms-console-addendum/` are outside the UGV validator's sole working-tree exception, `reports/ugv-simulation/**`. The configured ignored `.env` was not the cause, and the already-qualified eight-service stack remained running. This fail-closed source-integrity behavior does not invalidate the earlier passed deployment; run the one-click command from a clean committed delivery tree.

## Deployment profile

- The delivered Compose bundles qualify a single-node lab deployment. Multi-replica high availability, external TLS termination, backup/restore, and production observability operations are outside this addendum.
- Console management and Runtime credential descriptor arrays remain empty for this qualification profile, matching the current frozen contract's deferred-auth model. PMS Web is loopback-bound by default and sends no `Authorization` header. An internet-facing deployment requires a separately designed authentication and TLS boundary.
- The simulator, Device MCP, and MQTT broker remain external and are intentionally not packaged or mocked. Integrated startup therefore continues to depend on their network reachability and passive readiness.
