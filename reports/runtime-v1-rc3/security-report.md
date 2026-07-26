# v1.0.0-rc.3 Security Report

Date: 2026-07-17

Verified implementation commit: `19c818feadf6df7e16250279a14650e56c35ac24`

Result: PASS

- All 16 security tests passed, including strict boolean parsing and production fail-closed
  configuration for authentication, Adapter transport and Outbox delivery.
- `pnpm audit --audit-level high` reported no known vulnerabilities.
- The regenerated CycloneDX SBOM contains 184 production components and a lockfile hash.
- Eight Kubernetes manifests passed validation. The deployment uses two replicas, non-root UID,
  read-only root filesystem, dropped capabilities, RuntimeDefault seccomp and no service-account
  token mount.
- Two independently built `sdar-runtime:rc3-audit-*` images had identical filesystem/config
  shape, ran as `node`, excluded tests/docs/dev dependencies and measured 97,177,354 bytes against
  the 350,000,000-byte ceiling.
- Manifest drift is a readiness failure, Outbox publication failures retain events and block TTL
  purge, and ambiguous production configuration is rejected at startup.

The TypeScript and Python Mock Adapters are conformance references, not evidence that a concrete
production Adapter or resource is safe. Deployment still requires resource-specific security,
capacity and recovery qualification.
