# Phase R7 Implementation Report

- Start SHA: `66a55f6`
- Upstream main at pre-commit fetch: `7e501d07786a7695d205b0bc92b8fdbd667e7f96`
- Phase commit: `bb5e94120fec1662b70e849bfad736e392e5865c`
- Recovery fixture fix/end SHA: `e5736f7509fce22757745b1c0c4c47a9163468d3`

R7 adds startup and periodic durable recovery. Admission timing/TTL anchors survive response loss, PostgreSQL advisory locks serialize each Task, STARTING and bound nonterminal states use Reconcile, and pending controls replay the original command sequence. Transient failures retain confirmed state; a confirmed missing bound execution becomes explicit technical failure.

Runtime readiness waits for migrations, Manifest validation, Adapter connectivity, snapshot persistence, and the initial recovery scan. Periodic scan and scheduler database failures update dependency readiness while preserving rows.

Inbound auth supports explicit development, trusted headers, and signed HS256 JWT. Task ownership includes tenant/subject hash, execution mode, and simulation identity. Adapter transport accepts mutual TLS CA/client certificate/key configuration. HTTP body, JSON byte/depth/node, rate, schema and protocol limits apply before side effects.

Prometheus metrics cover Task state, calls/latency, cancel, recovery, Adapter RPC, Outbox, idempotency, and limiting. Structured correlation events contain the required identity fields without full arguments; logger redaction covers authorization and arguments.

Exit decision: PASS. GitHub Actions run `29498655990` passed recovery/security, real PostgreSQL, and Compose gates. R8 may proceed.
