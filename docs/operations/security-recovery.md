# Security, Recovery, and Telemetry

Runtime has three inbound authentication modes:

- `development` supplies a fixed anonymous identity and is intended only for local Compose;
- `trusted_headers` requires `x-sdar-subject` and `x-sdar-tenant` from an authenticated trusted proxy;
- `jwt_hs256` requires a secret of at least 32 characters and validates HS256, `exp`, optional `nbf`, configured issuer/audience, `sub`, and `tenant`.

Clients may select `live`, `simulation`, or `historical-replay`, but non-live requests must include a simulation id. Task ownership is the SHA-256 binding of tenant and subject plus the exact execution mode/simulation identity. Cross-context get, update, and cancel return not-found.

Set `ADAPTER_TLS_MODE=required` with `ADAPTER_TLS_CA_PATH`, `ADAPTER_TLS_CERT_PATH`, and `ADAPTER_TLS_KEY_PATH` for Runtime-to-Adapter mutual TLS. `disabled` is explicit plaintext development transport. Secret file contents and bearer tokens are redacted and are never included in task trace events.

Startup readiness requires database migrations, Adapter Manifest/connectivity checks, snapshot persistence, and an initial recovery scan. Recovery uses a transaction-scoped advisory lock per taskId. Recovery reconciles uncertain Admission and nonterminal Tasks. The Durable Command Dispatcher exclusively claims and executes persisted commands, including commands whose previous claim lease expired. Periodic scans provide polling fallback. TRANSIENT_UNAVAILABLE retains the last durable fact; confirmed missing bound execution becomes a visible technical failure.

Readiness continuously separates database, Adapter, Adapter Manifest, recovery, scheduler,
command dispatcher, Outbox publisher and TTL cleaner. Adapter probing is overlap-guarded and identity checked; an Adapter outage does not
mark PostgreSQL failed, and liveness is not coupled to an external dependency.

Idempotency records carry a stable task id and PostgreSQL-time claim lease. Claim/finalize are
short transactions around an Adapter RPC that owns no PoolClient. A duplicate polls durable
state, a failed caller expires its lease, and a crashed caller is taken over after lease expiry
with Reconcile before any safe retry. Source-IP rate state has an explicit per-replica key bound;
global production limiting remains the ingress/gateway responsibility.

Recovery candidates carry `nextRecoveryAt` and a consecutive failure count. Success resets the
count and moves the Task behind older due work; transient or thrown failures use persisted
exponential backoff with stable jitter. This prevents one old failure from occupying every
bounded scan while retaining eventual retries.

Task publication, scheduler acceptance and start-window compensation also reuse their checked-out
client for post-commit visibility reads. They never retain a client and request a second one;
pool-max-one regression and slow-Adapter capacity gates enforce this connection boundary.

The Adapter Manifest component compares each validated DescribeProvider hash with the immutable
startup hash. Any schema, capability, inventory, provider-version or operation drift latches that
component failed until the Runtime restarts against the intended Manifest.

`/metrics` exports Prometheus text for task states, Tool call count/latency, cancel requests,
Adapter RPC outcomes, recovery scans, idempotency hits, rate limiting, and pending Outbox events.
Optional OTLP Provider Ops Telemetry uses committed facts, bounded queues and a recursive
sanitizer. Raw arguments, input/answer values, Adapter payloads and authorization secrets are
never exported; telemetry failure cannot change readiness or business state. The complete signal
catalog is in [Provider Ops Telemetry](provider-ops-telemetry.md).

When production enables OTLP, the endpoint must use HTTPS. Collector authorization headers and
optional mTLS CA/certificate/key material are loaded from Secret-backed files, never ConfigMaps.
Invalid or unreadable exporter files disable telemetry with a sanitized warning; business startup,
readiness, product Outbox delivery, and durable Provider Ops capture continue. Collector failures
leave audit records retryable and may drop only bounded best-effort diagnostics.

The separate Provider telemetry ingress requires mTLS in production. Runtime authenticates the
Provider certificate identity, validates Task/resource binding, applies event-specific payload
allowlists, and persists an accepted fact before acknowledging it. See the
[Provider Telemetry Ingress protocol](../protocol/provider-telemetry-ingress.md).
