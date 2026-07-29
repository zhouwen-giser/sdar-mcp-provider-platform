# Platform 0.1.0 known limitations

- External SDAR infrastructure was unavailable. Controlled interoperability is
  not an external Interop Certified result.
- Real UGV and NPC Tank devices and ISR MQTT feeds were unavailable.
- Independently managed Home Assistant and physical climate resources were unavailable.
- PM2 is single-host only. This release has no Kubernetes Runtime orchestration,
  cross-host scheduling, multi-replica gateway, or arbitrary remote commands.
- The production Worker runs one Runtime replica per deployment.
- PostgreSQL backup, PITR, managed-service, multi-region, and production capacity
  qualification remain operator responsibilities.
- Database rollback migrations are unsupported; recovery is forward-only.
- The release remains pending until one exact-SHA GitHub Actions run, required
  repository protection, independent approval, and explicit Release Approval pass.
