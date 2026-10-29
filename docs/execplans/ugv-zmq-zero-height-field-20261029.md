# 1.3.0 zero-height contract, archive retirement and field acceptance

## Purpose / requirements

Implement the accepted 2026-10-29 plan on isolated branches. Preserve the primary checkout's
joint-packaging work. Retire only the two explicitly authorized old owner bindings and their
trajectory archives; preserve the current owner, Tasks, ZMQ archive and state snapshots.
Publish an additive 13-tool 1.3.0 contract with optional regional height defaulting to zero.
Field control, patrol action and report completeness require separate evidence.

## Context / architecture

Baseline SMPP 27f89cd9532e8ba214afc4341e3de3270d7a8787; SDAR
4cd2c56e64d41e5ec94d3f1e8836a6c53a485853. Formal is anonymous readonly 1.1.0;
control candidate is 1.2.0. GOWM current owner 0ab6028b-f367-4953-819f-ecca220a9a71
uses Server smpp-zmq-site. Old bindings c6a0eef5-05a5-467b-8f0a-4ab10530cd19 and
80099d63-dae7-4f5d-8f5e-7aa1113a47a8 hold approximately 65 GB receptions.

## Decisions / interfaces

- Add zmq_v1_3_0_site_control_13; preserve all previous exact catalogs and native wire contracts.
- Missing regional ellipsoidHeightM resolves to 0; null/nonfinite is invalid. Capture requested
  and effective parameters and per-vertex provided/default_zero provenance before confirmation.
- Navigation/patrol limit is 60 km/h (60 / 3.6 m/s), obstacle avoidance enabled. Entry point
  106.813064505,29.720529508; use the existing four-point region, with explicit zero heights
  after resolution. Unknown simulation-target heights stay null.
- Anonymous SDAR and optional strict JWT retain the original authorization domain. All physical
  plans require the existing exact confirmation; no uncertain replay or synthetic success.
- Archive administration uses scoped plan/apply/verify, owner pruning, CAS checkpoints and
  existing JSONB audit; keep FKs enabled and restore any reviewed delete guard in transaction.

## Progress

- [x] 2026-10-29 Confirm scope, height default, speed unit and clean tracked baselines.
- [x] 2026-10-29 Scoped retirement applied: 31,316,198 receptions, 44 projections, old streams/readers/sessions and two bindings removed; archive 24 KB, state snapshots 522255876096 bytes unchanged. Both retired Servers deleted by API (204).
- [x] 2026-10-29 Additive 1.3.0 Provider/Runtime/console and provenance implemented; all 21 SMPP gate commands pass with unchanged source.
- [x] 2026-10-29 SDAR exact catalog, pre-confirmation resolution and patrol successor implemented; 21-case native joint passes. Full SDAR gate remains in progress.
- [ ] Pass software gates and PostgreSQL/Redis/MCP/ZMQ/browser integration.
- [ ] Build candidate images; verify idle, leases, anonymous catalog and actual state.
- [ ] Execute operator-confirmed field cases, both effect sources, and native patrol.
- [ ] Promote only qualified formal control; record blockers/readonly rollback otherwise.
- [ ] Commit/push, deliver pinned packages, commands, exits and evidence SHA256.

## Validation / recovery / artifacts

Test omitted/zero/nonzero/null heights, finite values, km/h conversion, frozen confirmation,
catalog drift and legacy isolation. Archive tests cover conflict, repeat, interruption/resume,
reader revocation, protected rows, FK and trigger restoration. Run the SMPP full site gate and
SDAR full gate plus native joint suite. Private inputs remain under .smpp-debug; public evidence
under /mnt/data/ugv-zmq-zero-height-field-20261029. No raw-archive duplicate backup is created.
Only empty archive tables may be truncated without CASCADE; otherwise ordinary VACUUM.
Service rollback is anonymous readonly; committed archive deletion is not undone by rollback.

## Discoveries / outcomes

Existing native AreaSearch requires numeric ellipsoid heights. Zero is an explicit operator
default, not a measured terrain value; native rejection remains a field failure/blocker.
No field actions or archive deletion have yet been performed in this increment.

### Maintenance and integration discoveries

The original inclusive-prefix owner prune times out after large amounts of dead tuples. The
remaining tail uses an equivalent lower bound (sequence > the already-pruned frontier) inside
an owner transaction. The original procedure definition is restored and checked before every
commit; its source SHA256 and the optimized SHA256 are recorded. No frozen migration changes.
The repeated/interruption/FK-rollback fixture passes nine cases with 40,000 actual receptions.

For 1.3.0 only, candidate control uses the already-supported 1000 ms native exchange and
2000 ms database bounds; the former 250/500 ms loopback configuration intermittently cannot
complete a connection under joint load. Existing uncertainty/no-replay tests stay unchanged.
Live readonly observation shows EO/effect idle/fresh, but localization stale; no navigation
admission bypass is permitted.
