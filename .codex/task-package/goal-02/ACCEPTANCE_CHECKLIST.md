# Goal 2 Acceptance Checklist

- [x] Goal 1 Handoff verified.
- [x] RuntimeDeployment desired/observed states and API are revision-safe.
- [x] DatabaseProfile/Provisioner/Secret Store create isolated Runtime DB and role.
- [x] Runtime migration runs once before process start and preserves failure evidence.
- [x] PM2 Adapter uses Fork Mode, allowlists entry/cwd/env/name and cannot manage other processes.
- [x] Runtime supports stable instance/deployment identity and Secret files.
- [x] Reconcile converges desired state; PM2 online is not treated as ready.
- [x] PMS outage does not stop running Runtime; crash recovery uses PM2 + Runtime persistence.
- [x] Identity check, official Catalog discovery and Registry no-op revisions work.
- [x] UGV/NPC/HA provider platform E2E are truthful about qualification.
- [x] Console shows Provider/Config/Runtime/Catalog/Registry/Audit without leaking Secrets.
- [x] Security/fault tests pass; SDAR Interop is either executed or explicitly blocked without fake certification.
- [x] 50 Goal 2 tasks PASSED and `pnpm verify:platform` passes for available environment.
