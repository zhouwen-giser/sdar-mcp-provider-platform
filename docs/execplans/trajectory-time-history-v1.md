# ExecPlan: authoritative trajectory reception time and retained-history proofs

Status: implementation complete; frozen final acceptance pending. Owner: SMPP.
Started: 2026-10-12 (Asia/Shanghai). Updated: 2026-10-13.

## Objective and authorization

Supply SDAR with a versioned public read extension carrying each trajectory
sample's original reception evidence and a verifiable, bounded history proof.
The human request was made in chat `01a125c4-2cb8-7220-85c3-f21ea549f8d4` and
delegated to this chat. Local implementation, isolated PostgreSQL/MQTT tests and
contract delivery are authorized. Site reads/writes, device operations and
redeployment remain NOT_RUN. This request adds no push/merge authorization.

The original checkout has the completed joint-packaging work uncommitted. Keep
it intact. Work here on `codex/trajectory-time-history-v1`, based on
`ae345aa4e4b8d78b14a65092ab89139c6a50a0d8`. Preserve Frozen MCP 2026-07-28,
TaskBusiness 1.0-rc2 and BusinessEvents 1.0 assets and task/control semantics.

## Baseline findings

- `VehicleMqttClient` calls `ingress.handle` synchronously on the MQTT message
  event. The ingress computes reception time but does not retain a per-message
  journal; duplicate and old observations can return before snapshot publication.
- `NavigationTrajectoryProcessor` deliberately samples, coalesces stationary
  geometry, splits at 256 coordinates and stores the last observation in Context.
  This is a projection, not a complete receipt history. Retain this behavior.
- The trajectory projector can correlate GNSS using current, freshness-qualified
  Mission state. Such a correlation is not a Mission identity reported in the
  original GNSS message. New evidence must label the distinction explicitly.
- Existing synchronous, resource-bound MCP operations can deliver an optional
  read extension through the current Adapter transport. No new execution command
  or execution permission is needed.
- Shared storage belongs to GOWM's explicit owner installer. Runtime startup is
  verify-only. SMPP already supplies forward owner SQL for its hosted business
  domain; apply the same ownership, checksum and transaction discipline.

## Milestones

### M0 — baseline and contract decision

- [x] Verify the human request, current tree, existing trajectory and ingress.
- [x] Create an isolated managed worktree from the actual current HEAD.
- [x] Record baseline source/asset hashes and actual baseline commands.
- [x] Complete ADR and public contract shapes before wire implementation.

### M1 — capture, immutable storage and proof primitives

- [x] Capture reception identity, UTC wall clock, clock owner/precision and
      process-local monotonic ordering at the actual MQTT callback, before decoding,
      deduplication, stale-observation filtering or geometry projection.
- [x] Retain device-reported time and sequence with original field provenance.
      Missing clocks, unknown time bases, clock regressions, duplicates, late and
      retained deliveries remain explicit. Provider ordinals are never device proof.
- [x] Introduce forward migrations for the receipt ledger, session/recovery
      diagnostics and immutable geometry-to-receipt sidecars. Preserve old records;
      do not assign new timestamps to old geometry. Verify upgrade, retry and rollback
      without deleting history. Keep standalone and hosted owner installation paths.
- [x] Persist a receipt before accepting its history projection; record failed
      capture, disconnection and unclean restart bounds. Bound queue/memory usage.
- [x] Implement canonical SHA-256 chains and Ed25519-signed range manifests with
      a separately trusted key. Verify supplied proofs against a caller-pinned key,
      never a key supplied by the proof being checked.
- [x] Run related regressions and attempt the repository complete milestone gate.
      Earlier failures and fixes are preserved; combined frozen acceptance is pending
      under M3. An earlier failed complete command is not retroactively marked PASS.

### M2 — public read, stable pagination and sample provenance

- [x] Add opt-in, resource-bound synchronous read operations for reception
      history and trajectory Artifact evidence. Discover their explicit versions and
      JSON Schemas through the normal catalog. Disabled/old services keep their catalog.
- [x] Bind cursors to the scope, immutable snapshot/watermark and caller; persist
      signing authority so a restart does not silently invalidate a valid snapshot.
- [x] Report range boundaries, counts, chain anchors, sequence/retention gaps,
      session recovery and pagination completion independently of device completeness.
- [x] Link newly selected geometry coordinates to actual receipt identities;
      retain null/unknown evidence for old coordinates and unproven Mission ownership.
- [x] Validate the full public read path with an isolated real PostgreSQL database,
      local MQTT and explicitly SIMULATED messages. Include hostile cursors/proofs,
      cross-device/Mission isolation, page boundaries, restart and retention cases.
- [x] Run relevant regressions after every increment and attempt the complete gate.
      All constituent suites passed after repairs. The final single complete command
      remains an explicit M3 gate on the frozen source.

### M3 — frozen delivery and SDAR intake assets

- [ ] Freeze implementation to a local source SHA and check immutable old assets.
- [x] Prepare schemas, full/incomplete/unknown examples, field provenance, proof
      verification algorithm/SDK, capability negotiation and migration/runbook docs.
- [ ] Publish a machine-readable acceptance matrix referencing actual command,
      exit status, source identity, raw log and SHA-256 for every conclusion.
- [ ] Run final complete gates on the frozen source and audit the delivered bytes.
- [ ] Report implemented guarantees and exact remaining producer/owner prerequisites.
      Keep real-device qualification, site operations, deployment and consumer changes
      explicitly separate from local SIMULATED acceptance.

## Completeness semantics and upstream limits

Distinguish a finite, committed Provider receipt set from all physical MQTT
callbacks and from all samples a device should have produced. A sealed ordinal
range can prove its retained entries and its end-of-pagination condition. It
cannot prove that an unjournaled crash window or a disconnected producer lost
no samples. Unclean sessions and capture gaps must not disappear from diagnostics.

The inspected producer does not supply a trusted producer epoch, signed sequence
boundaries or complete-generation attestation. Device-wide complete history must
remain unknown/incomplete until such a producer contract exists. Header sequence
numbers, Provider auto-increment values and identical message digests are not
substitutes. Do not invent producer guarantees or backfill device time/Mission
ownership from current state.

## Validation and evidence discipline

Use Node 22 and pnpm 11.13.1. Execute tests only against task-owned isolated
databases/brokers and ephemeral loopback ports. Never point a test at the shared
19100 deployment or an existing GOWM database. Preserve failures as failures;
do not weaken assertions. Formal milestones include `pnpm verify:v2` and the
UGV/TaskBusiness owner/native regression gates, with unrelated baseline failures
identified rather than relabeled PASS. Save commands and original logs under
`reports/trajectory-time-history-v1/`; secrets and private signing keys live only
in ignored, temporary test configuration. Hash every delivered evidence file.

## Progress log

- 2026-10-12: verified explicit human delegation; created the managed worktree,
  preserved packaging changes in the original checkout and started frozen dependency
  installation. No site operations or device queries were executed.
- 2026-10-13: implemented the callback journal, atomic immutable PostgreSQL ledger,
  stable bounded signed snapshots, public read tools, persisted operator key,
  Artifact sidecars and owner-controlled native/GOWM forward installation. Native
  migration is 033 to preserve existing 030/031/032; hosted extension is new 031.
- Actual MQTT-to-PostgreSQL-to-gRPC-to-HTTP MCP readback, writer SIGKILL/restart,
  broker stop/start, queue overload, owner installation rollback/retry, RLS,
  retention, hostile proof/cursor and 300-entry pagination tests passed locally.
  The fully pinned GOWM owner source `cd4d748878390bb7a9ed93af3ed6a6c36cc4069f`
  was exported to a task-owned fixture; no existing GOWM database was modified.
- Clean `ae345aa4` source exports reproduced stale Runtime migration-count and
  stable-roster test expectations. Repairs assert the exact existing 28 migrations
  and a genuinely unchanged reversed roster; no production behavior was weakened.
  These baseline runs linked current installed dependencies and do not certify
  the original dependency lockfile. Cancel-persistence latency failures are retained;
  no timing threshold was changed, and the full integration rerun passed 546/546.
- The required high/critical dependency audit initially failed. Compatible patched
  dependencies and scoped overrides removed high/critical findings. The installed
  registry has no published braces 3.0.4; replacing PM2's unused chokidar dependency
  removed that path. Existing 51 PM2 tests and actual independent PM2 lifecycle E2E
  passed. Original advisory ignores remain unchanged; moderate/low findings remain.
- `m2-verify-v2-04` passed frozen, protocol, Business Events, format, lint, types,
  build, audit, SBOM, container and all six test categories; its exit was 1 because
  system Python lacked pip. Existing conformance interpreter configuration now uses
  the application's Python 3.12 runtime, without installing into system Python.
  Standalone Python/TypeScript conformance and capacity then passed. Final full
  acceptance still requires an actual exit-0 complete command on frozen source.
- Final receipts, machine acceptance and a byte-audited intake/source archive are
  generated by `scripts/trajectory-history/create-delivery.mjs SOURCE_SHA` only after
  all same-source final gate receipts pass. Reports keep all failed commands.
  Real SDAR interop lacks its consumer fixture and remains NOT_RUN; Adapter
  conformance does not upgrade the Runtime's partial resource-safety certification.
- `be2fece6` passed the actual complete `m3-verify-v2-01` command with exit 0 and
  unchanged source, including Python, capacity and final report checks. Deployment
  review then found the optional hosted history checksum JSON was absent from UGV
  images. Both UGV image targets now carry it; the general UGV target also carries
  the existing GOWM contract. A mounted image fixture verifies the actual production
  image against the isolated full GOWM with its non-bypass application role. Final
  source acceptance requires that image check and another complete same-source gate.
