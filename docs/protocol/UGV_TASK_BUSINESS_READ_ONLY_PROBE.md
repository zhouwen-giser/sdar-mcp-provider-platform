# Read-only TaskBusiness probe (`1.0-rc2` development)

Run the public consumer against an authorized local `/mcp` endpoint:

```sh
COREPACK_HOME=/tmp/smpp-corepack corepack pnpm task-business:probe --mcp-url http://127.0.0.1:PORT/mcp --task-id TASK_UUID --max-events 10 --duration-ms 10000
```

Set `SMPP_TASK_BUSINESS_PROBE_TOKEN` in the environment if the endpoint requires a bearer token. The token is sent as an Authorization header and is not included in NDJSON output. The default invocation calls `io.sdar/taskBusiness/context/get`, `io.sdar/taskBusiness/snapshotParts/get` when a page has descriptors, and `io.sdar/businessEvents/listen`. With `--artifact-id ID`, it also calls the read-only `io.sdar/taskBusiness/artifacts/get` method before listening; `--artifact-revision N` selects an exact version (otherwise the first response fixes the version) and `--artifact-chunk-bytes N` sets a 1–1,048,576 byte chunk limit. The default invocation never creates a Task, answers Required Input, invokes Intervention, or calls a device. An explicit `--mode input --input-manifest` path is documented separately in [UGV manual input probe](UGV_TASK_BUSINESS_MANUAL_INPUT_PROBE.md).

The probe fetches every Context page at one revision, validates the complete Context, and keeps the **first page's public** `resumeFrom`. For an oversized Context or object descriptor it calls `io.sdar/taskBusiness/snapshotParts/get` with that page's signed token and exact object reference, reads bounded consecutive chunks, verifies descriptor size and full SHA-256, and parses the complete JSON before reducer validation. A changed revision or public stream generation fails the read and requires a fresh snapshot. It then connects to the existing POST SSE listener. One connection cursor advances on every delivered public notification, including legacy or other Task events, and is reused after reconnect. The verified Task ID routes only `vehicle.business` messages for the selected Task into `normalizeTaskBusinessSseNotification` and the pure reducer. The reducer's `resumeFrom` advances with the public cursors of those business messages and never moves backward; it may lag the probe's separate connection cursor when unrelated notifications arrive. Business messages are deduplicated by `messageId`; object refs advance only by object revision. Metadata changes (phase, active refs, effective plan and summary) advance by Context revision, with the snapshot revision as a lower bound, so an overlapping old phase cannot roll back the snapshot. Unknown optional kinds remain opaque diagnostics and never create a command. A generation continuity notice or replay rejection refreshes the snapshot before listening again.

SSE frame size is limited to 2,097,152 characters per frame, including a partial frame waiting for its terminator. A transport read may contain many smaller complete frames; their aggregate size does not trigger the single-frame limit.

The compatible Context identity may omit optional `simulationId`; the authorized Runtime Task binding supplies the scene scope when normalizing an event. The reducer checks that field when the Context includes it and rejects `CONTEXT_FINALIZED` if its declared final revision differs from the event revision. Once a newer Context revision is applied, a delayed older event cannot rewrite its metadata or object references even if the event names a higher object version. The same-revision terminal metadata and finalization pair still applies; after finalization, later business events do not reopen or change the read model.

Each stdout line is one JSON object with `schema: "sdar.task-business-probe-ndjson/v1"`. Types are `snapshot`, `businessObject`, `artifact`, `artifactContent`, `businessEvent`, `cursor`, `refresh`, `error` and `stopped`. A `snapshot` line includes `objectCount`; exactly that many `businessObject` lines follow it, each carrying a validated exact `{kind, value}` plus the snapshot Context revision and public `resumeFrom`. These lines expose Artifact, Action, RequiredInput and Intervention values obtained from the authorized public Context pages. Referenced Artifact content bytes still require the separate read method. An `artifactContent` line appears only after all chunks pass identity, version, metadata and offset checks and the assembled bytes match the immutable SHA-256; the bytes themselves are not emitted. An inline or unavailable Artifact emits `artifact` metadata. A `businessEvent` line carries both `publicCursor` and `sourceCursor` to keep their domains distinct. `unresolvedRefs` identifies newer object versions announced by a stream message whose full object value is not in the previous snapshot; the reducer removes stale cached values instead of presenting them as current. When this list is nonempty, the probe closes the current SSE read, fetches a complete public Context snapshot and resumes from that snapshot's new public `resumeFrom`. That snapshot must reach at least the event's Context revision and, within the same public generation, at least its public cursor; an older snapshot fails with `BUSINESS_SNAPSHOT_BEHIND_STREAM`. Action/Input/Intervention values are recovered through the public read; a missing or unreadable exact version fails the snapshot rather than appearing resolved. The event line can show unresolved refs, followed by a refreshed snapshot and its object lines. The connection cursor is emitted after each event; the probe retains it in memory across SSE reconnections. It bootstraps a new snapshot on every process start, so an old cursor is never paired with missing reducer state. `--max-events` and `--duration-ms` bound the run.

For consumer integration evidence, add `--capture-public-payloads` (programmatic
`capturePublicPayloads: true`). Each `snapshot` then also carries the complete
validated `context`, including fields omitted from the default summary. Chunked
Context values are captured only after digest verification and hydration. Each
applied `businessEvent` also carries its original parsed JSON-RPC `notification`,
including the public envelope and `rawPayload`. The notification must belong to
the selected Task's `vehicle.business` source and pass normalization/reduction.
Other Task/source events, rejected messages and duplicates are not included in
this capture. HTTP headers, bearer tokens and signed snapshot capability tokens
are not emitted. The output contains actual selected public business data; it is
not a byte-for-byte HTTP/SSE session dump. Default output remains unchanged.

The navigation qualification runner enables this option. Its captures can be
checked offline with
`node --import tsx scripts/task-business/replay-public-navigation.mjs CAPTURE.json [RESULT.json]`.
The verifier rebuilds the captured snapshots, normalizes each original selected
notification, checks the resulting read model and cursor domains, and verifies
duplicate-event no-ops. Missing payloads and foreign Task binding are rejected.
It contacts no Runtime, database or device. This is a reproducible SMPP consumer
check, not an external SDAR integration result.

`docs/protocol/examples/UGV_TASK_BUSINESS_READ_ONLY_PROBE.ndjson` shows one complete synthetic, one-page snapshot with all four exact object values and a bounded stop. It is a contract handoff example built from `protocol/task-business/v1/examples/positive-catalog.json`, not a captured selected UGV or SDAR run. The catalog includes an Input and Intervention to illustrate the wire shape; the selected read-only UGV Profile does not advertise those write capabilities.

Contract tests exercise the reducer with synthetic catalog objects and the probe over a local HTTP/SSE fixture, including multi-chunk Context and Action descriptors and a damaged digest. That fixture is a test double for the public server, not external SDAR integration or selected GOWM simulation. The public query itself was tested separately in UGVB-021, and the local PostgreSQL-to-SSE path in UGVB-020. An isolated native PostgreSQL test now runs this probe against the actual localhost Runtime `/mcp` and UGV gRPC server: it hydrates over 1 MiB Context and Action values, then consumes a committed Provider business event through the public SSE stream. The Device client and the follow-up event are local test fixtures; this is not an external SDAR client or selected GOWM simulation.
