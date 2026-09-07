# P10 Benchmark Diagnostic Handoff

Generated at 2026-09-01 for the live UGV Provider/SMPP instance. This handoff qualifies only the diagnostic control plane with arm, status, and disarm requests. It did not create a P10 Task, issue navigation, call a Referee mutation, publish MQTT, or invoke a weapon operation.

## Source and instance identity

- Branch: `codex/smpp-mcp-tasks-ugv-diagnostic-support-v0.1`
- Implementation commit and OCI revision: `141693fa5898afee49fa96f7c8b183ca322094aa`
- Provider ID: `isr.vehicle.ugv.ugv1`
- Runtime MCP endpoint: `http://127.0.0.1:19100/mcp`
- Runtime image: `sdar-ugv-simulation-real/runtime:141693fa5898afee49fa96f7c8b183ca322094aa`
- Runtime image ID/digest: `sha256:c5ec6b093c784e325bdea078a42fa705ac3be15d9013a44c595564ec37479bdd`
- Runtime container: `smpp-real-integration-ugv-runtime-1`
- Runtime startedAt: `2026-09-01T11:41:54.754418443Z`
- Runtime restartCount: `0`
- Runtime state: `running`, Docker health `healthy`
- Adapter image: `sdar-ugv-simulation-real/ugv-adapter:141693fa5898afee49fa96f7c8b183ca322094aa`
- Adapter image ID/digest: `sha256:7656d047a7c65473909a0043421eec9c3150f32775a5ebd2e13283c093c831a4`
- Adapter container: `smpp-real-integration-ugv-adapter-1`
- Adapter startedAt: `2026-09-01T11:39:29.705995237Z`
- Adapter restartCount: `0`
- Adapter state: `running`; it has no Docker healthcheck and is covered by Runtime's adapter and manifest readiness dependencies.

`GET http://127.0.0.1:19100/health/ready` returned HTTP 200 and `status=ready`. Database, Adapter, Adapter Manifest, recovery, scheduler, command dispatcher, TTL cleaner, outbox publisher/cleaner, Provider Telemetry ingress, and every listed Business Event dependency were `ready`.

## Frozen diagnostic contract

- Contract: `sdar.smpp-diagnostics/v1`
- Contract hash: `2635495abfba805940876f3efe64d014761490af1ce102f9afce4e8bc3d5b25a`
- Public read-only description: `GET /v1/diagnostics/contract`
- Authentication header on control and status routes: `x-sdar-diagnostic-token`
- Authentication scheme: `scoped-operator-token`
- Credential handoff file on the host: `/tmp/smpp-diagnostic-control/operator.token` (mode 0600; value intentionally excluded)
- Runtime credential file env: `SMPP_DIAGNOSTICS_OPERATOR_TOKEN_FILE=/run/secrets/smpp_diagnostic_operator_token`
- Adapter credential file env: `UGV_DIAGNOSTICS_CONTROL_TOKEN_FILE=/run/secrets/smpp_diagnostic_operator_token`
- Enable gates: `SMPP_DIAGNOSTICS_ENABLED=true`, `UGV_DIAGNOSTICS_ENABLED=true`
- Maximum TTL gates: `SMPP_DIAGNOSTICS_MAX_TTL_MS=300000`, `UGV_DIAGNOSTICS_MAX_TTL_MS=300000`

The exact request and response JSON Schemas are returned by the contract endpoint and are included in the contract hash. The arm request has:

```json
{
  "contract": "sdar.smpp-diagnostics/v1",
  "action": "arm",
  "idempotencyKey": "string (1..256)",
  "ttlMs": "integer (1000..3600000; live gate caps at 300000)",
  "scope": {
    "runId": "string",
    "caseId": "UGV-MCP-003 or UGV-XCHAIN-003",
    "caseExecutionId": "string",
    "repetitionId": "string",
    "logicalInvocationId": "string",
    "taskId": "optional string"
  }
}
```

The disarm request has `contract`, `action=disarm`, `idempotencyKey`, and `leaseId`. Status is an authenticated GET by `leaseId`. A successful response contains `contract`, `capabilityId`, `contractHash`, a lease, and its append-only receipt. The lease exposes `leaseId`, capability/fault/boundary identity, `injectionCount=1`, `operationName=vehicle_navigate`, stable operation key, canonical request hash, idempotency key, fence, state, scope, timestamps, and bound Task/Execution/Mission identities when available. The receipt exposes receipt/lease IDs, action, request hash, time, state, and reason code. Unknown fields fail validation.

### Response-loss capability

- Capability ID: `SMPP-DIAGNOSTIC-RESPONSE-LOSS-V1`
- Control: `POST /v1/diagnostics/response-loss` with `action=arm|disarm`
- Status: `GET /v1/diagnostics/response-loss/:leaseId`
- Frozen fault: `drop-response-after-durable-side-effect`
- Frozen boundary: `provider-after-durable-mission`
- One-shot injection count: `1`

The Adapter atomically binds the armed lease only after the original Task, Provider Execution, Device Mission, and navigation start side effect are durable. It then consumes the one-shot, emits authoritative ProviderOps with the exact original identities and `response_lost_after_adapter_success`/`redispatchAllowed=false`, and suppresses the first successful dispatch response. Runtime classifies this condition as response loss and forbids redispatch. A repeated start resolves the existing execution instead of issuing a second southbound dispatch; reconciliation and continuation retain the original object identity.

### Provider business-success contradiction capability

- Capability ID: `SMPP-DIAGNOSTIC-PROVIDER-BUSINESS-SUCCESS-V1`
- Control: `POST /v1/diagnostics/provider-business-success` with `action=arm|disarm`
- Status: `GET /v1/diagnostics/provider-business-success/:leaseId`
- Frozen fault: `provider-business-success`
- Frozen boundary: `provider-terminal-business-semantics`
- One-shot injection count: `1`

This capability attaches only to an exact matching normal navigation execution and takes effect at its Provider terminal observation. It creates authoritative Provider `businessStatus=succeeded` while explicitly preserving `claimsPhysicalArrival=false` and `claimsGoalSuccess=false`; it does not call a Referee waypoint/start API, fabricate physical arrival, write Telemetry/ClickHouse/Benchmark storage directly, or mark Runtime Goal/A2A completion. ProviderOps retains exact Task, Execution, Mission, and Provider observedAt. The Referee remains solely responsible for independent physical truth and `failed_out_of_tolerance`.

For both capabilities, disarm and expiry fail closed. The PostgreSQL lease state is fenced and identity-immutable, while cleanup receipts are append-only. Idempotent replay returns the same lease and receipt.

## Zero-motion live qualification

At `2026-09-01T11:40:26.972Z`, authenticated arm replay, status, disarm, and disarm replay were executed against the deployed 19100 instance for each capability. Every call returned HTTP 200.

Response-loss qualification:

- leaseId: `84cd89bc-118d-4225-9a71-7cc56289d332`
- fence: `3`
- stableOperationKey: `f5c5d4b225b158678e6a78fccbff4e5f223d9daf9d9bc362a46aa8bc88ac9c93`
- canonicalRequestHash: `1afcc60a17335a3c66a4b1af718d25c329454cf00cc44d928bf947e0772ef2f1`
- arm receiptId: `78ea1ca7-2f93-434d-899c-696f07ec7aed`
- arm replay kept the same lease and receipt
- status observed `ARMED`
- final state: `DISARMED`; cleanupAt `2026-09-01T11:40:26.901Z`
- disarm receiptId: `6bf1af9b-9bad-4a53-8e04-b8c518543837`
- disarm replay kept the same lease and receipt

Provider business-success qualification:

- leaseId: `dd71fe47-fc5c-448d-a538-d57fa4209801`
- fence: `4`
- stableOperationKey: `91c161af2e5554f7f046a484dca897f9112bb5b63eca557a1a59d1415549666f`
- canonicalRequestHash: `d8a21a4f23e93594f9eae0a34ced1089b05df55e4bfb198a9a07377ddd641d74`
- arm receiptId: `84c29662-984b-4935-9a50-f646b26b735e`
- arm replay kept the same lease and receipt
- status observed `ARMED`
- final state: `DISARMED`; cleanupAt `2026-09-01T11:40:26.952Z`
- disarm receiptId: `cec44222-c959-4f17-92cb-20bd311d8a11`
- disarm replay kept the same lease and receipt

Post-qualification PostgreSQL evidence: four qualification leases are `DISARMED`, four `armed` and four `disarmed` append-only receipts exist, active diagnostic leases are zero, and active UGV Provider executions are zero. An unauthenticated arm request returned HTTP 401 with `diagnostic_authentication_required` and did not create a lease.

## Southbound and catalog evidence

- Device MCP remains the real southbound endpoint `http://192.168.2.63:19000/mcp`.
- MQTT remains the real southbound broker `mqtt://192.168.2.63:1883`.
- `UGV_EXECUTION_MODE=live`; no local mock or mutation-blocking simulation mode is active.
- A read-only MCP `tools/list` against 19100 returned HTTP 200, 10 tools, and includes `vehicle_navigate` alongside the four read and five other mutation operations.
- A direct read-only `get_status` against the remote Device MCP after qualification returned position `x=-340.18, y=109.45, z=0.01`, `speed_kmh=0`, brake `1`, and chassis task `{id:-1,type:-1,state:0,progress:-1}`. These match the pre-deployment idle baseline, proving the control-plane qualification did not move or task the vehicle.

## Verification

- Repository-required `pnpm verify:ugv-provider`: PASS, including formatting, lint, typecheck, build, proto checks, 11 UGV unit tests, 8 contract tests, 64 integration tests, 4 security tests, and 2 end-to-end tests.
- Runtime diagnostic API suite: 2/2 PASS.
- `pnpm test:config-compat`: PASS, including 8 config-compat and 45 Runtime config-contract tests.
- Targeted diagnostic regressions cover no redispatch and exact Mission ProviderOps after response loss; Provider business success without arrival or Goal-success claims; idempotent arm/disarm; expiry; authentication; Runtime proxying; and config inventory.

This is the exact deployed instance available for Benchmark preflight. It is not the earlier three-tool Revision 1 fixture and must not be represented as one.
