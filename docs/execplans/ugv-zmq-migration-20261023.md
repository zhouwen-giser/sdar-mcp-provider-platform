# UGV ZMQ migration execution plan — 2026-10-23

## Scope and current phase

Implement the reviewed migration design in explicit phases. The user authorized phase 1: freeze the three southbound contracts and deployment dependencies, establish verifiable wire fixtures and a fail-closed qualification record. Later phases introduce live observation ingestion, task execution, inspection/simulation outcomes, deployment and rollback. Phase 1 does not publish or qualify a new control operation by itself.

Source baseline: `d26002f127a4152ee1dc034950501be2f182b6ea`. Reuse the attached worktree `/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform`, branch `codex/ugv-zmq-phase1-20261023`. Preserve the primary checkout's existing united packaging changes.

Inputs: the three supplied Markdown protocols under `/home/sz/Documents/zmq/`, the reviewed design and its seven findings. Original protocol bytes and terminology provenance remain recorded in `/mnt/data/ugv-zmq-migration-20261023/`.

## Phase 1 work

- [x] Inspect the reviewed design, repository instructions, source and deployment assumptions; request missing endpoint/identity/source information.
- [x] Freeze exact protocol snapshots, source hashes, supported message inventory, known deficiencies and their qualification consequences in the repository.
- [x] Implement strict, transport-independent wire contract validators and binary decoding/fixture support; preserve numeric precision, message identity, framing and nullable evidence semantics.
- [x] Add a versioned candidate deployment profile and qualification command that distinguishes unverified deployment inputs, observed facts and actual control qualification.
- [x] Obtain passive publication evidence where reachable, without sending business commands; record protocol drift and distinguish observed captures from constructed reference fixtures.
- [x] Validate malformed/foreign/truncated messages, input profile drift and fail-closed qualification; run typecheck, build, lint/format and frozen protocol checks appropriate to this phase.
- [x] Record source, commands, exit codes, hashes and remaining G0 conditions; commit the phase deliverable.

## Completion criteria

The source deliverable is complete when snapshots are reproducibly verified, documented wire contracts are executable and tested, a candidate profile can be audited, and the preflight reports exact unresolved prerequisites rather than declaring unknown features supported. Full G0 clearance additionally needs actual deployment identities, capability/physical/time agreements, authoritative provider frames/source and a signed-off capability scope. Unavailable external confirmations remain explicitly unresolved; local tests cannot replace them.

## Decisions and evidence

- The existing `/home/sz/.codex/AGENTS.md` is empty; no project AGENTS.md applies. No subagents used.
- Initial read-only TCP check found ports 10001, 11001, 5555, 5556, 5557, 5558 and 7879 reachable at 192.168.2.63. This proves TCP reachability only, not device identity or protocol conformance.
- G0 inputs requested: confirmed endpoints and IDs, simulationId, 7879 policy, and local source/raw-frame paths. The operator replied “是”, confirming all three hosts remain 192.168.2.63. The reply supplied no concrete IDs, simulation binding, 7879 policy or provider source path; these remain unresolved. Host confirmation is recorded separately and does not satisfy the full deployment-identity evidence requirement.

## Later phases

1. Contract/dependency freeze and qualification foundation (local deliverable complete; external G0 clearance pending).
2. Read-only ZMQ observation, provenance and reception storage.
3. Navigation/camera task lifecycle, bounded scheduling, recovery and stopping.
4. Inspection evidence, simulation effect task/result query and operator UI.
5. Governed publication, single-writer handoff and deployment package.
6. Field acceptance and tested rollback/disabled diagnostic mode.

## Phase 1 closeout — 2026-10-23

The local deliverable is implemented: three logical source contracts plus the original simulation-effect presentation source, 17 pinned inputs, strict binary/JSON validators, constructed reference vectors, an inactive deployment/business candidate, SUB-only capture tooling and a fail-closed preflight. The original and revised simulation-effect JSON/YAML examples are checked for equality. No Runtime operation, transport selection, production dependency or running container was changed.

Validation: 47 tests passed in three files; root typecheck/build, targeted ESLint, format, contract-lock and frozen northbound protocol checks passed. Initial passive capture retained 18 valid samples across all three components; a separate verification of the shipped capture helper retained another 10 valid samples. Both captures sent zero business commands. The five chassis reference vectors are independently constructed fixtures, not provider-confirmed command captures.

G0 remains pending: 13 missing deployment/evidence prerequisites, plus the per-operation protocol gaps in `contracts/ugv-zmq/v1/known-gaps.json`. The preflight intentionally returns exit 2 with `g0Ready=false` and `runtimeAdmission=not_published`. Provider/controller/simulation binding, coordinate/time/physical limits, 7879 policy, capability signoff, implementation provenance and provider golden frames require external confirmation. No phase 2 runtime observation driver or live control has been qualified by these tests.

Reviewable evidence: `reports/ugv-zmq-phase1/REPORT.md`, `verification.json`, `G0-candidate.json` and `raw/`. The report fixes the baseline, Node/pnpm versions, exact commands, exit codes and SHA-256 hashes. The delivery commit identifies the final source tree; subsequent provider input must be a reviewed update to the candidate.
