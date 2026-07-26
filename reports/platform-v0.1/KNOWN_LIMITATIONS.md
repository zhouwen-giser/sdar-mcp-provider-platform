# V0.1 known limitations

- Real UGV and NPC Tank devices and ISR MQTT feeds were unavailable.
- An independently managed Home Assistant deployment and physical climate
  resources were unavailable.
- External SDAR infrastructure was unavailable. The delivered result is a
  controlled local interoperability pass, not external Interop Certified
  status.
- Database backup, point-in-time recovery, managed-service qualification,
  multi-region failover, and production capacity qualification remain operator
  responsibilities.
- PM2 is the delivered Runtime process adapter for V0.1; it is intentionally not
  a general remote execution interface.
- Database rollback migrations are not supported. Recovery is forward-only with
  application artifact rollback where schema compatibility permits.
