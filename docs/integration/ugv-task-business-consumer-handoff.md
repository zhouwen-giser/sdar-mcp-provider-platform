# UGV Task Business consumer handoff (interim)

This handoff describes the public `1.0-rc2` consumer path implemented in this repository. The default UGV Profile remains conservative. The explicitly configured airport navigation Profile now supports qualified route adoption and plan adjustment; manual recon input remains gated. Examples are not external SDAR qualification. See the real navigation evidence in `reports/business-feedback-final-convergence-v1.2/V_REPLAN_SOURCE.md`.

## Read an existing Task

Use an authorized Runtime Task ID and the public `/mcp` endpoint. The command is read only and emits bounded NDJSON:

```sh
COREPACK_HOME=/tmp/smpp-corepack corepack pnpm task-business:probe --mcp-url http://127.0.0.1:PORT/mcp --task-id TASK_UUID --max-events 10 --duration-ms 10000
```

Set `SMPP_TASK_BUSINESS_PROBE_TOKEN` in the process environment if authentication is required. The probe does not print the token. It calls `io.sdar/taskBusiness/context/get`, resolves snapshot descriptors through `io.sdar/taskBusiness/snapshotParts/get`, then listens with `io.sdar/businessEvents/listen`. Read [the probe contract](../protocol/UGV_TASK_BUSINESS_READ_ONLY_PROBE.md) before consuming its output. [This NDJSON example](../protocol/examples/UGV_TASK_BUSINESS_READ_ONLY_PROBE.ndjson) is a **synthetic contract fixture**, including Input and Intervention shapes; it is not a selected UGV or SDAR capture.

Keep the two cursor domains separate. `resumeFrom` and each event's `publicCursor` belong to the Runtime public stream and are suitable for public listen/reconnect. `sourceCursor` identifies the Provider source event and is provenance only. Fetch every Context page and exact object version before using the snapshot's `resumeFrom`. On an event with unresolved object refs, refresh the public snapshot before showing those values as current. Deduplicate by message ID and object revision. Apply `contextDelta` by Context revision: several typed events may share one revision, including terminal metadata followed by `CONTEXT_FINALIZED`.

## Answer one existing UGV Input

For a named isolated scene with a current `target.disposition_decision`, use [the explicit input probe and manifest](../protocol/UGV_TASK_BUSINESS_MANUAL_INPUT_PROBE.md):

```sh
COREPACK_HOME=/tmp/smpp-corepack corepack pnpm task-business:probe --mode input --input-manifest /path/to/isolated-input-manifest.json
```

The manifest fixes the Runtime Task, Execution, scene, Provider/resource, request ID/key/revision/deadline and lock session. Its `decision` selects `continue_observation`, `decline`, or `cancel`. The probe reads the public Context and `tasks/get` first, then uses the existing `tasks/update` `inputResponses` map once with an authenticated user token. The Runtime derives the responder from that authentication, not from the request body. `resultType: complete` is Runtime acceptance; an `answered`, `declined`, or `cancelled` RequiredInput at the next exact revision, with the matching response and a still-running Task, is Provider business application. These public facts do not prove physical lock release or scan resume.

An input `cancel` dismisses the pending decision. It does not call `tasks/cancel` or terminate the Task. Set `cleanupTaskAfter: false` to observe the Task continuing after `decline` or `cancel`. Optional cleanup is a separate `tasks/cancel` request for the named Task and reports physical confirmation separately. The local HTTP fixture verifies these wire distinctions; live UGV source and external SDAR evidence remain required.

## Plan adjustment boundary

The public conditional method is `io.sdar/taskBusiness/interventions/apply`. Its receipt's `durablyAccepted` means Runtime queue acceptance. A Provider `submitted` Intervention and command ledger entry are separate from an `applied` Intervention, adopted effective plan revision, and independent device observation. The [explicit navigation adjustment probe](../protocol/UGV_TASK_BUSINESS_INTERVENTION_PROBE.md) submits one guarded command and hydrates the exact public result. It requires a qualified available entry. The explicit `isr_airport` configuration now publishes `navigation.adjust_plan`; two real adjustments and full Runtime/Provider restart passed through public MCP on a disposable complete GOWM SMPP installation. Other profiles and recon adjustments remain gated. The synthetic local HTTP/PostgreSQL/gRPC example in [the interaction contract](../protocol/UGV_TASK_BUSINESS_INTERACTIONS.md) exercises the generic Runtime path only.

## Versioned SDAR compatibility assessment

The read-only source assessment on 2026-09-28 used `skill-driven-agent-runtime` commit `f94d0b98d140dd22514029ccdc34978209426940`. Its existing `packages/mcp-adapter/src/business-events-client.ts` consumes `io.sdar/businessEvents/listen`; `frozen-v1-task-lifecycle.ts` submits `tasks/update` input responses through the existing remote Task input path. Its `apps/server/src/runtime.ts` also has a GOWM verification branch and device-scoped repositories. Reuse those foundations.

At that commit, the inspected server, application, MCP adapter and persistence sources contain no calls to `io.sdar/taskBusiness/context/get`, `snapshotParts/get` or `interventions/apply`, and no TaskBusiness object reducer. The consumer integration still needs complete Context/object hydration, separate public/source cursors, exact result-reference resolution, and mapping of the explicit Input/Intervention lifecycle described above. Source inspection is not an SDAR runtime test. The similarly named `sdar-mcp-tasks-provider-runtime` repository is a separate Tasks Runtime and does not establish the full SDAR consumer's capability.

The earlier disposable PostgreSQL 18 assessment used GOWM owner commit `9a993699777b13813873bef138c3533125eb0748`. All 35 pinned SMPP installation checksums and all 81 pinned SDAR installation checksums matched the corresponding owner entries; different Git pins alone were not a contract failure. That installation failed the application-role startup marker read and lacked business tables. This is historical evidence, not the current sz-gowm permission state.

The 2026-09-29 read-only sz-gowm check found that `ugv_smpp_app` already has `SELECT` on `public.schema_migration`, but all four `ugv_task_business_*` tables remain absent and `UGV_PROVIDER` history ends at `029`. The [owner handoff template](../../contracts/gowm-shared-storage/task-business-owner-handoff.sql.template) now explicitly includes marker read grants; the consumer expects the actual `UGV_PROVIDER` migration family. The owner still needs to install the business overlay and publish its matching checksum contract. The [selected GOWM qualification suite](ugv-task-business-gowm-qualification.md) must then pass through the strict opener. No selected database switchover or live SDAR run was performed.

The unified [manual acceptance CLI](../protocol/UGV_MCP_MANUAL_ACCEPTANCE.md) discovers tools before public reads and can assert exact Artifact/Action/Input/Intervention state. It defaults to read-only; writes require an explicit switch and the existing guarded probes. Acceptance labels are recorded in `reports/business-feedback-final-convergence-v1.2/SCENE.json` with the user's permission to generate them. They are not a verified simulator build. The new [Provider auto-lock coordinator](../protocol/UGV_TASK_BUSINESS_PROVIDER_AUTO_LOCK.md) is component-tested; recon source identity, V-OBS and V-INPUT remain unqualified.

## Real navigation samples

The [complete navigation payload handoff](../../reports/business-feedback-final-convergence-v1.2/evidence/navigation-public-payload-handoff/README.md) contains eight hashed NDJSON files from a successful public Runtime run: 19 full validated Context snapshots, 38 original parsed business notifications across process restart, two Intervention lifecycles and the terminal Task result. The [capture and replay record](../../reports/business-feedback-final-convergence-v1.2/V-PUBLIC-PAYLOADS.md) provides an offline command that reproduces the consumer read model and checks duplicate no-ops. Public/source cursors remain distinct. Notifications retain their original parsed envelope and rawPayload, while credentials, headers, signed snapshot tokens and byte framing are excluded. This does not qualify external SDAR.

The [earlier projection-only handoff](../../reports/business-feedback-final-convergence-v1.2/evidence/navigation-public-handoff/README.md) is retained separately. It lacks complete Context/notification payloads and cannot be used by the new raw-payload replay verifier. Its fields were not reconstructed or mixed with the later run.

## Evidence still required for integration

Complete the same-candidate Input/recon capture when a reset-safe source session is available, using the full-payload option for consumer evidence. Bind captures to the source fingerprint, Profile variant, Runtime Task, device version and selected GOWM database. For each Input or Intervention, record the public receipt, exact Provider object revisions/events, source cursor, Task state and independent device outcome. External SDAR must run its own public consumer against that same candidate. Navigation simulation, complete public payload replay and selected local GOWM persistence evidence now exist, separately from synthetic examples. External `SDAR_INTEGRATION`, reconnaissance workflows and deployed-candidate qualification remain pending.
