# v1.1.0 Security and Privacy Report

Date: 2026-07-18

Verified implementation commit: `a8195fea874159b482934aad2709008a0ac00c4e`

## Result

PASS. `pnpm verify` executed 18 security tests in 4 files, and the dependency audit reported no
known vulnerabilities at the configured high-severity threshold.

Provider Ops Telemetry is opt-in and production remains fail-closed: enabling OTLP requires an
explicit endpoint, transport is OTLP only, and default Compose/Kubernetes configuration leaves
telemetry disabled. Runtime has no ClickHouse or SDAR Core dependency or network path.

The sanitizer is applied at log, trace and metric exporter boundaries. It recursively rejects or
removes raw arguments, input values, Adapter payloads, authorization material, passwords, tokens,
JWTs, cookies and secrets. Metric attributes use an explicit bounded allowlist and exclude task,
execution, user, authorization, argument and correlation identifiers.

Exporter failures, timeouts, queue saturation, serialization failures and shutdown failures are
best effort and cannot change Task outcomes or readiness. Batch sizes, queue sizes, timeouts and
attribute/event size are bounded. Lifecycle audit events derive from committed persistence facts;
rolled-back transitions do not emit audit events.

This report validates the reference Runtime controls. Operators remain responsible for collector
TLS, authentication, access control, retention and downstream data governance.
