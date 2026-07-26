# OSS Intake: fast-uri security patch

- Package: `fast-uri`
- Classification: transitive production dependency security override
- Upstream: `https://github.com/fastify/fast-uri`
- Versions: `3.1.4` and `4.1.1`
- Commits: `6aeece669e4166b2446a89f17c07a3b15dfb7ed4` and
  `f3e437f7c79431c8b646bbba45e7cb1b4df708ed`
- License: BSD-3-Clause; both package releases contain `LICENSE`; no `NOTICE` file is present
- Integrity: npm SHA-512 values are recorded in `pnpm-lock.yaml` and
  `third_party/sources.lock.yaml`
- Purpose: replace vulnerable `3.1.3` and `4.1.0` dependency graph nodes reported by
  `pnpm audit --audit-level high` under Ajv/MCP SDK and Fastify
- Alternatives: waiting for every direct dependency to republish would leave the release gate
  exposed; replacing Ajv or Fastify is broader and duplicates existing authoritative components
- Source use: package dependency only; no source is copied, adapted, vendored, or forked
- Compatibility: patch releases within each existing major line; full Provider verification is
  required
- Maintenance: remove the exact overrides after direct dependencies resolve to patched versions
  and a lockfile-only update preserves the gate
