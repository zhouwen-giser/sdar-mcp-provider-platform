# UGV Task Business consumer handoff (interim)

This handoff describes the public `1.0-rc2` consumer path implemented in this repository. The selected UGV Profile still gates manual input and plan adjustment. No external SDAR consumer, named live UGV scene, or device action is qualified by these examples.

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

The public conditional method is `io.sdar/taskBusiness/interventions/apply`. Its receipt's `durablyAccepted` means Runtime queue acceptance. A Provider `submitted` Intervention and command ledger entry are separate from an `applied` Intervention, adopted effective plan revision, and independent device observation. The selected UGV Profile currently advertises no accepting Intervention and the UGV handler returns a negative Ack; there is no runnable UGV adjustment example or applied-plan result to present. The synthetic local HTTP/PostgreSQL/gRPC example in [the interaction contract](../protocol/UGV_TASK_BUSINESS_INTERACTIONS.md) exercises the generic Runtime path only.

## Evidence still required for integration

Capture redacted **real** NDJSON in a separate live-evidence directory once a named scene and application-level MQTT/MCP sessions are available. Bind it to one source fingerprint, Profile variant, Runtime Task, device version and selected GOWM database. For each Input or Intervention, record the public receipt, exact Provider object revisions/events, source cursor, Task state and independent device outcome. External SDAR must then run its own public consumer against that same candidate. Until those results exist, `SDAR_INTEGRATION`, `SIMULATION_BUSINESS` and selected `PERSISTENCE` remain `NOT_RUN` or unqualified; do not promote the synthetic fixture.
