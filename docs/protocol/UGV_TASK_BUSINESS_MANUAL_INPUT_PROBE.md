# UGV manual input probe (development, explicit write mode)

The default `task-business:probe` remains read-only. The separate `--mode input` path answers **one existing** `target.disposition_decision` with `continue_observation`; it never creates a Task, sends a device tool command, or selects another target. Optional cleanup calls `tasks/cancel` for only the named Task. Use it only with an isolated UGV scene, a Task already at `input_required`, and an authenticated user bearer token. `SMPP_TASK_BUSINESS_PROBE_TOKEN` is read from the environment and never written to the NDJSON output. The Runtime must validate its user identity; an anonymous or development identity cannot answer this request.

Create a local manifest for the exact pending request shown by the read-only probe:

```json
{
  "schema": "sdar.ugv-manual-input-probe/v1",
  "mcpUrl": "http://127.0.0.1:PORT/mcp",
  "authorizationRef": "local-isolated-run-authorization-record",
  "sceneInstanceId": "runtime-simulation-id-for-this-scene",
  "taskId": "TASK_ID",
  "executionId": "EXECUTION_ID",
  "providerId": "PROVIDER_ID",
  "resourceId": "RESOURCE_ID",
  "requestId": "REQUEST_ID",
  "requestKey": "REQUEST_KEY",
  "requestRevision": 1,
  "deadlineAt": "2026-09-27T00:00:00Z",
  "lockSessionId": "LOCK_ACTION_ID",
  "targetId": "TARGET_ID",
  "decision": "continue_observation",
  "cleanupTaskAfter": true,
  "maxPolls": 10,
  "pollIntervalMs": 1000
}
```

`sceneInstanceId` must equal the `simulationId` in the public RequiredInput identity. If a deployment uses a different scene identifier, obtain a verified Runtime mapping first; the probe fails closed. The authorization reference is an audit pointer, not a token or authorization grant. Do not put credentials in the manifest.

```sh
COREPACK_HOME=/tmp/smpp-corepack corepack pnpm task-business:probe --mode input --input-manifest /path/to/isolated-input-manifest.json
```

Before writing, the probe reads the complete public business snapshot and `tasks/get`. It checks the active request revision, deadline, Task/Execution/Provider/resource/scene identity, target, lock session, and public Runtime input metadata. A mismatch or an elapsed deadline exits before `tasks/update`. After one `tasks/update` call it emits `runtimeAccepted`, which means only that the Runtime accepted the request. It then polls public business snapshots for the answered RequiredInput and reports `businessAnswerConfirmed` with `qualification: runtime_wire_only` and `deviceEffectConfirmed: false`. A timeout or unexpected terminal state exits nonzero. A real V-INPUT qualification additionally needs the native device lock/release/scan timeline and selected storage and SDAR evidence.

With `cleanupTaskAfter: true`, the probe calls `tasks/cancel` for only the named Task after a `tasks/update` attempt, including when its HTTP response is lost or the answer poll fails. It does not cancel if preflight expires before the update attempt. It emits `cleanupRequested` for a successful Runtime acknowledgement; it does not claim physical stop confirmation. The setting defaults to `false` for a manually supervised session. Stop or clean up only the named Task through the authorized Task control workflow. Do not run it against shared or unknown scenes.
