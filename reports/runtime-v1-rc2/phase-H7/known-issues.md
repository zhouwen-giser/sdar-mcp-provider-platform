# H7 Known Issues and Residual Risk

- MCP HTTP is deliberately stateless. Runtime does not support resumability, server-sent
  notifications, or GET/DELETE session lifecycle on `/mcp`; clients must poll persisted Tasks.
- Adapter health uses `DescribeProvider`. Operators must size the probe interval for the real
  Adapter and monitor probe latency/failures; this is not a deep resource health check.
- Idempotency leases have no heartbeat. `IDEMPOTENCY_LEASE_MS` must remain greater than the
  Adapter RPC timeout. Recovery reuses the stable identity and Adapter idempotency/reconcile
  boundary, but an Adapter that violates that contract is unsafe.
- Rate-limit state is process-local and bounded. Multi-replica global quotas require an external
  distributed limiter; no global quota claim is made.
- Docker Engine size reporting differs from Docker Desktop/containerd. The 350 MB guard and
  327,026,557-byte baseline are explicitly the GitHub Linux Engine measurement.
- H8 still owns append-only migration audit and expanded dual-language conformance T-047..T-049.
