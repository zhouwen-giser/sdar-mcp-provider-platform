# EP-SMPP-SDAR-HOME-LAB-INTEGRATION-SUPPORT

## Objective and scope

Provide the authoritative SMPP half of Goal Run `019fca75-f48a-7780-ac5e-942503c6690e`: freeze and
serve SMPP-SDAR Registry Projection Contract V1.0, publish reachable Climate/Light candidates,
support live MCP discovery and Tasks, execute Home Assistant side effects only through the Provider
Adapter boundary, produce objective observations/evidence, and prove recovery without duplicate
physical effects. SDAR goal, planning, binding, continuation and outcome authority remain outside
this repository.

The required branch is the retained `codex/ha-real-device-preparation`, initially
`981792b9cb22f8b3117fe3ab26f639de71487d1f` and byte-identical to `origin/main` after PR #9.

## Requirements covered

- G01: preserve and qualify the merged Climate/Light Providers, Runtime deployments and Registry.
- G02-G03: publish canonical projection assets and strict latest/bootstrap/watch behavior with
  SDAR-compatible checksum, TTL, ETag, lineage headers, authentication and negative tests.
- G04-G06: publish real reachable candidates while never making Registry authoritative for tools,
  Tasks, SDAR capabilities or SDAR outcomes.
- G07-G11: provide authoritative MCP Tasks, Adapter calls, HA confirmation, observations, evidence,
  idempotency and restoration for read-only and explicitly gated write scenarios.
- G12-G13: qualify Registry/Runtime/Adapter/fault recovery, no replay, full SMPP gates and secret
  scans; publish `reports/sdar-integration-support/`.
- G14-G15: publish an independent SMPP PR and optionally merge only when its explicit switch and all
  protected gates permit it; retain the support branch permanently.

## Authority and contract invariants

- Native Registry DTO, repository, snapshot, checksum and publication workflow remain unchanged.
- Projection reads the native repository; it does not create a second authority table or mutate the
  native snapshot. Native `tools` are excluded.
- Projection checksum is distinct, deterministic, request-time independent and includes the exact
  `smppSourceId`. ETag is the quoted projection checksum. Watch is a hint only.
- PMS owns package/configuration/deployment/Catalog/Registry control; Runtime owns MCP Tasks;
  Provider Adapter owns HA access and side effects; HA owns actual state.
- Registry and telemetry never decide Task terminal state. SMPP never creates or terminates an SDAR
  Goal and never modifies SDAR Workflow state.
- Credentials and internal entity IDs remain only in ignored local files and are redacted from APIs,
  logs, reports, fixtures and committed configuration.

## Progress

- [x] 2026-08-10 20:49 +08:00 fetched origin, verified clean retained support branch, exact equality
      with `origin/main`, and the post-merge PR #9 SHA.
- [x] 2026-08-10 20:49 +08:00 recorded shared Goal lock, repository identities and exact SHAs.
- [x] 2026-08-10 21:05 +08:00 re-ran the real read-only Home Assistant preflight (10/10),
      migrated all three isolated SMPP databases, and proved active/uncertain Task counts are 0/0.
- [x] 2026-08-10 21:15 +08:00 ran focused Climate (20/20), Light (9/9), and provider-package
      (13/13; four-package self-check) prerequisites against the candidate worktree.
- [x] 2026-08-10 21:42 +08:00 froze all six G02 assets from SDAR commit
      `a9957c82c17ca01e77528f3817c03d86224aaf88`, including ten checksum/rejection vector classes,
      strict three-level schemas, source lock and raw-byte manifest.
- [x] 2026-08-10 21:42 +08:00 implemented G03 as an independent read-only consumer projection;
      latest/bootstrap/watch, ETag/304, native lineage, Bearer authentication, redaction and Watch
      disconnect cleanup passed 18 focused tests, 25 PMS regressions and a 5/5 PostgreSQL Registry gate.
- [x] 2026-08-11 completed G04-G07 live support: final Source replay retained native Registry
      revision 2 and exactly two Candidates; revision-17 Climate/Light Bindings matched Runtime
      Tool revisions; exact Climate 4 / Light 3 catalogs and deterministic read-only execution plus
      same-run replay passed with no physical write.
- [x] 2026-08-12 supported G08 end to end: one real SDAR A2A Task invoked the exact Light and
      Climate `get_state` operations once each through the live SMPP Runtimes, returned Provider
      evidence into one combined Outcome, and remained queryable after the SDAR Runtime restart.
- [ ] G09/G10 completed bounded real SMPP Runtime/Adapter/Home Assistant writes, idempotency checks
      and restoration, but remain partial because the SDAR governed Goal/Plan path was not run.
- [ ] G11 executed real parallel Climate/Light tasks but failed because the Climate objective did
      not remain stable; all devices were restored and the process-scoped gates were closed.
- [ ] G12 is blocked. Controlled Runtime/Adapter/provider and same-Goal read-only recovery coverage
      passed, but Required real in-flight restart, HA fault and corrupt-state cases were not executed.
- [ ] G13 cross-repository acceptance is blocked by the SDAR full-run Phase 13 Runtime P95
      regression (`39.981096754646735% > 10%`). SMPP candidate source gates passed.
- [x] Committed and pushed tested candidate `5b17f12ff7312449cc7e3376795ff24c0375b9d9`
      on the retained support branch and published blocked Draft PR #10. No merge, tag, release,
      public deployment or support-branch deletion is authorized.

## Discoveries and decisions

- The earlier real-device preparation intentionally ended with functional readiness true and full
  SDAR integration false; this plan does not promote those historical results without current live
  evidence.
- Existing user containers and volumes are preserved. Integration databases use the exact names in
  the Goal package, and Redis uses a dedicated instance or Goal-specific prefix.
- Real writes remain disabled unless `ALLOW_REAL_DEVICE_SIDE_EFFECTS=YES` and a unique non-empty
  `REAL_DEVICE_TEST_RUN_ID` are present. Climate power is not required and remains blocked without
  its extra switch.
- SMPP main merge remains disabled without `ALLOW_SMPP_MAIN_MERGE=YES`; no force push, tag, release,
  public deployment or support-branch deletion is permitted.
- SDAR checksum and URL behavior were locked from the actual algorithm sources rather than inferred
  from documentation. Candidate identity order is
  `smppSourceId::externalProviderId::externalServerId`; canonical object keys use `localeCompare`.
- The task package defines `2592000` as the TTL default, not a maximum. Explicit TTL is therefore a
  positive safe integer; projection fails closed if the derived JavaScript Date is out of range.
- G02/G03 add no persistence or second authority. The original Registry model/builder/repository,
  migration and `registry-routes.ts` have an empty Git diff after implementation.
- The pre-existing `reports/real-device-preparation/ha-preflight.*` changes and concurrently created
  `reports/sdar-integration-support/` artifacts were not edited as part of G02/G03.
- The latest G04 replay after SDAR restart returned the same successful operation for the same
  idempotency key and retained exact native/projection lineage. SMPP native Registry protected
  implementation files still have an empty diff.
- Runtime readiness evidence is time-bounded. The G06 `available` observation is claimed only for
  its observation/G07 admission interval, not after its TTL expired.
- G09-G11 were executed under a unique process-scoped write run. G09/G10 provider paths passed;
  G11 exposed a real Climate state reversion. The failure is preserved without result-seeking
  retries, all devices are restored and the write gates are closed.

## Implementation and validation sequence

1. Inventory the current native Registry, repository/API composition, Runtime, Climate/Light
   Adapter, package/deployment, preflight, durable Task and recovery code plus exact test commands.
2. Run the smallest current G01 tests and an isolated PostgreSQL/Redis readiness gate; record the
   first stable failure and authority owner.
3. Generate `protocol/consumer-projections/sdar-registry/v1/` with strict schema, error catalog,
   manifest, source lock and required checksum vectors. Prove native Registry regression tests.
4. Add latest/bootstrap/watch to the existing Registry HTTP composition with Bearer authentication,
   strict source validation, projection ETag/304, native lineage headers, missing-LKG 404, redaction
   and hint-only SSE. Use the native repository rather than a new table.
5. Publish reachable Runtime endpoints through the formal PMS path, then support SDAR live source
   sync, exact binding discovery and Catalog drift tests.
6. Run read-only MCP Tasks before gated physical scenarios. For writes, capture initial HA state,
   enforce bounded attempts and idempotency, confirm state through Adapter/HA, retain durable Task
   identity/evidence, and restore through the same formal path.
7. Exercise Registry, Runtime, Adapter, notification, HA and state-file failures without duplicate
   side effects or uncertain Tasks. Production rejects test failpoints.
8. Run focused and full SMPP/cross-repository gates, secret scans and exact-commit review; update
   reports, commit/push and publish the retained-branch PR.

Required validation includes `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`,
`pnpm protocol:check`, Provider package/Climate/Light/platform tests, `pnpm verify:v2`,
`pnpm verify:platform`, projection HTTP/contract/vector tests, live interop and recovery. Commands
requiring PostgreSQL use explicit isolated `TEST_DATABASE_URL`. Real evidence is never inferred from
simulated, contract, static or unverified results.

Current candidate evidence passed the full SMPP platform gate before report-only refresh, plus the
frozen contract verifier, native Registry protection check and G01-G08 live support. These SMPP
passes do not override the blocked cross-repository G09-G13 requirements or the failed authoritative
SDAR full verification. Final publication validation must re-run formatting/diff/protocol checks
after all report and status edits.

## Idempotence, recovery, artifacts and outcome

All publication and Task identities include stable revisions or Goal Run ID. Repeated projection
reads and retries are byte-stable; Runtime/Adapter restarts retain durable state and reconcile rather
than replaying a call. A failure signature receives at most three repair attempts. Uncertainty stops
all additional writes and produces a manual blocker with current/restoration state.

Canonical contract assets live at `protocol/consumer-projections/sdar-registry/v1/`; SMPP interop
reports and final handoff live at `reports/sdar-integration-support/`; cross-repository state lives at
`../.codex-sdar-smpp/`.

Final Draft-publication outcome is `BLOCKED`: G01-G08 passed; G09/G10 are provider-path partial and
G11 failed its real device objective; G12 lacks Required real fault evidence; and G13 cross-repository acceptance is
blocked by the SDAR Phase 13 full-run regression. Active/uncertain SDAR Tasks are `0/0`,
active/uncertain SMPP Tasks are `0/0`, device restore is `RESTORED`, write gates are closed, and
`crossRepositoryIntegrationReady=false`. Independent commit/PR traceability and the final explicit
code-versus-external blocker list are recorded in the final handoff; this status is not merge
authorization.
