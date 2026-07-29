# Platform 0.1.0 known limitations

- External SDAR infrastructure was unavailable. Controlled interoperability is
  not an external Interop Certified result.
- Real UGV and NPC Tank devices and ISR MQTT feeds were unavailable.
- An independently managed Home Assistant deployment and physical climate
  resources were unavailable.
- PM2 is a single-host Runtime process adapter. Platform 0.1.0 does not provide
  Kubernetes Runtime orchestration, cross-host scheduling, a multi-replica
  gateway, or arbitrary remote command execution.
- The delivered production Worker uses one Runtime replica per deployment.
- PostgreSQL backup, point-in-time recovery, managed-service qualification,
  multi-region failover, and production capacity qualification remain operator
  responsibilities.
- Database rollback migrations are not supported. Recovery is forward-only with
  application rollback only where schema compatibility permits.
- Branch-protection Required Checks must be configured by a repository
  administrator using the exact names in `docs/review/GOAL04_CI_MATRIX.md`.
