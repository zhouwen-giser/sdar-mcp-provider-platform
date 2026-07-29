# Blockers

## Non-blocking Goal 2 environment gaps

- `G2-P0-B02`: PM2 CLI and JavaScript API are not installed. Unit and component work proceeds
  with the documented FakePm2 contract. Real PM2 lifecycle E2E requires a repository-pinned PM2
  dependency, isolated `PM2_HOME`, a built allowlisted Runtime entry, and tests restricted to
  `sdar-runtime-*`.
- `G2-P0-B02`: PostgreSQL host CLI tools and `TEST_DATABASE_URL` are absent, but Docker daemon
  29.6.1 and a healthy PostgreSQL 17.10 Compose service are available. Integration work can use
  the Node `pg` client with an externally injected, redacted URL. Production-like provisioning
  E2E additionally requires a non-superuser role limited to `CREATEDB` and `CREATEROLE`.
