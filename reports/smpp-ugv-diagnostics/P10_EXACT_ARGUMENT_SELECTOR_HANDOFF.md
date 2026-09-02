# P10 Exact Argument Selector Handoff

Generated 2026-09-02 for the live UGV Provider/SMPP diagnostic instance. This supersedes the pre-invocation selector in the 2026-09-01 handoff; the frozen diagnostic fault boundaries are unchanged.

## Contract blocker remediation

The old arm contract required `scope.logicalInvocationId`, but FrozenV1 does not send `x-correlation-id` and Runtime generates that value during the MCP invocation. The deployed contract now requires an exact selector known after deterministic P6 materialization:

```json
{
  "scope": {
    "runId": "string",
    "caseId": "UGV-MCP-003 or UGV-XCHAIN-003",
    "caseExecutionId": "string",
    "repetitionId": "string",
    "selector": {
      "operationName": "vehicle_navigate",
      "argumentHash": "64 lowercase hexadecimal characters"
    }
  }
}
```

- Hash algorithm: `sha256-json-recursive-object-key-sort-v1`.
- Hash input: exact `vehicle_navigate` arguments after deterministic materialization.
- `logicalInvocationId` is not an arm field.
- The first exact argument-hash match atomically freezes `logicalInvocationId`, Task ID, Provider Execution ID, and Device Mission ID into the lease and append-only bound receipt.
- A nonmatching navigation does not bind.
- Concurrent active leases using the same selector, including cross-capability leases, are rejected with `SMPP_DIAGNOSTIC_SELECTOR_CONFLICT`.
- PostgreSQL uses a selector advisory transaction lock, exact selector index, fenced lease, one-time null-to-value identity binding, and immutable bound identities. Ambiguity fails closed.
- Response loss remains `drop-response-after-durable-side-effect` at `provider-after-durable-mission`, `injectionCount=1`, with no redispatch.
- Provider business success remains scoped Provider terminal semantics with `claimsPhysicalArrival=false` and `claimsGoalSuccess=false`; Referee retains independent physical truth.

## Source and exact runtime identity

- Branch: `codex/smpp-mcp-tasks-ugv-diagnostic-support-v0.1`
- Implementation commit and deployed OCI revision: `60f4ef34ed4cc882dd07b413b56f7ae79ab1e393`
- Provider ID: `isr.vehicle.ugv.ugv1`
- Runtime MCP endpoint: `http://127.0.0.1:19100/mcp`
- Runtime image: `sdar-ugv-simulation-real/runtime:60f4ef34ed4cc882dd07b413b56f7ae79ab1e393`
- Runtime image digest: `sha256:17aa3d7d37ecfed6e57aa8780fa3b7ad856d27c2994329d31039982d26f11fe8`
- Runtime startedAt: `2026-09-02T01:57:56.990856877Z`
- Runtime restartCount: `0`; state `running`; Docker health `healthy`
- Adapter image: `sdar-ugv-simulation-real/ugv-adapter:60f4ef34ed4cc882dd07b413b56f7ae79ab1e393`
- Adapter image digest: `sha256:94a7bba775296b3ac4bb804d5cf60076b8c3a5bbce1658ea2b2e1ef0ade5ef04`
- Adapter startedAt: `2026-09-02T01:56:13.956073581Z`
- Adapter restartCount: `0`; state `running`
- Migration `029_smpp_diagnostic_exact_argument_selector.sql`: applied; `selector_argument_hash` present

`GET /health/ready` returned HTTP 200 with `status=ready`. Database, Adapter, Adapter Manifest, recovery, scheduler, command dispatcher, TTL cleaner, outbox, Provider Telemetry ingress, and all Business Event dependencies were `ready`. Read-only `tools/list` returned 10 tools and includes `vehicle_navigate`.

## API and authentication

- Contract: `sdar.smpp-diagnostics/v1`
- New contract hash: `5f3e158dd994958e1fcd99e294d7b4da783fd07dbbf82254d91c09696af21ec2`
- Exact schema: `GET /v1/diagnostics/contract`
- Response-loss control/status: `POST /v1/diagnostics/response-loss`, `GET /v1/diagnostics/response-loss/:leaseId`
- Business-success control/status: `POST /v1/diagnostics/provider-business-success`, `GET /v1/diagnostics/provider-business-success/:leaseId`
- Header: `x-sdar-diagnostic-token`
- Host credential file: `/tmp/smpp-diagnostic-control/operator.token`, mode `0600`; value intentionally excluded
- Runtime env names: `SMPP_DIAGNOSTICS_ENABLED`, `SMPP_DIAGNOSTICS_OPERATOR_TOKEN_FILE`, `SMPP_DIAGNOSTICS_MAX_TTL_MS`
- Adapter env names: `UGV_DIAGNOSTICS_ENABLED`, `UGV_DIAGNOSTICS_CONTROL_TOKEN_FILE`, `UGV_DIAGNOSTICS_MAX_TTL_MS`
- Container credential path: `/run/secrets/smpp_diagnostic_operator_token`
- Unauthenticated control returned HTTP 401 `diagnostic_authentication_required`.

The response schema exposes the selector on the lease. Bound and consumed receipts can expose the frozen binding with `operationName`, `argumentHash`, `logicalInvocationId`, `taskId`, `externalExecutionId`, and `deviceMissionId`.

## Zero-motion live qualification

Only diagnostic arm, status, and disarm APIs were used; no P10 Task, navigation, Referee call, MQTT publish, or device mutation was issued.

Response-loss:

- HTTP sequence arm/replay/status/disarm/replay: `200,200,200,200,200`
- leaseId: `5ab5aa05-2718-45d8-9b41-610f41e7f296`
- fence: `5`
- selector argumentHash: 64 `1` characters
- arm replay lease and receipt stable
- ARMED lease had no `logicalInvocationId`, proving it is learned only on exact bind
- final state: `DISARMED`; cleanupAt `2026-09-02T01:58:46.663Z`
- disarm receiptId: `c958f1d5-5314-4061-a66a-20555e238912`; replay stable

Provider business success:

- HTTP sequence arm/replay/status/disarm/replay: `200,200,200,200,200`
- leaseId: `6b7c5cfa-fefd-4e86-9584-fb69dbf7874c`
- fence: `6`
- selector argumentHash: 64 `2` characters
- arm replay lease and receipt stable
- ARMED lease had no `logicalInvocationId`
- final state: `DISARMED`; cleanupAt `2026-09-02T01:58:51.856Z`
- disarm receiptId: `7e21e79b-5ab4-4c8d-9759-abe30472d2a7`; replay stable

Post-qualification durable state: active diagnostic leases `0`, active Provider executions `0`, active Runtime tasks `0`. One explicitly read-only `get_status` probe was attempted after deployment and recorded `protocol_error`; mutating Device tool calls since deployment remained `0`.

## Verification

- `pnpm verify:ugv-provider`: PASS from the final implementation tree.
- UGV suites: unit 11, contract 8, integration 65, security 4, E2E 2; all PASS.
- `pnpm test:config-compat`: config compatibility 8 and Runtime configuration contract 45; all PASS.
- Runtime diagnostic API: 2 PASS.
- Migration provenance: 1 PASS; append-only sequences 028/029 fixed at 36/37.
- Selector regressions cover exact match and learned binding, nonmatch no-bind, same/cross-capability conflict rejection, response-loss no-redispatch, Provider success without physical/Goal claims, idempotent cleanup, and expiry.

## Southbound status at handoff

Configuration remains real and live:

- Device MCP: `http://192.168.2.63:19000/mcp`
- MQTT: `mqtt://192.168.2.63:1883`
- `UGV_EXECUTION_MODE=live`; no mock fallback or mutation-blocking simulation execution mode

At handoff time, the remote Device MCP accepted TCP but closed or timed out on read-only MCP requests. The deployed 19100 control plane and frozen catalog remain ready using the captured real catalog, but an attempted read-only `vehicle_get_state` returned HTTP 500 because the remote southbound was unavailable. This is a separate external availability condition: Benchmark may validate the diagnostic control preflight now, but must not start a physical/simulator navigation case until its southbound readiness probe succeeds.

## Southbound recovery qualification

The preceding external availability condition cleared without a service or container restart. At `2026-09-02T02:20:43.437Z`, a new read-only qualification through the exact 19100 Runtime produced:

- `GET /health/ready`: HTTP 200, `status=ready`, all dependencies ready.
- MCP `tools/list`: HTTP 200, 10 tools, `vehicle_navigate` present.
- MCP `vehicle_get_state`: HTTP 200, `resultType=complete`, `isError=false`.
- Connectivity: `deviceMcpConnected=true`, `mqttConnected=true`, `deviceAvailable=true`.
- Chassis: mission state `0`, speed `0 km/h`, position `29.720490138598283 / 106.81179412346586`.
- Direct southbound identity: `ugv-mcp-server` version `1.26.0`, 15 tools.
- Direct read-only status: speed `0`, brake `1`, chassis task `{id:-1,type:-1,state:0,progress:-1}`.
- Active diagnostic leases `0`, active Provider executions `0`, active Runtime tasks `0`.
- Mutating Device tool calls since deployment `0`; the fresh Adapter `get_status` audit outcome was `accepted`.

The exact Runtime and Adapter identities, images, startedAt values, restartCount values, OCI revision, contract hash, and credential paths above are unchanged. The external southbound blocker is therefore resolved for read-only preflight; no Task, navigation, Referee operation, MQTT publish, or Device mutation was used to recover or qualify it.
