# Goal 2 Acceptance Checklist

- [ ] Goal 1 Handoff verified.
- [ ] RuntimeDeployment desired/observed states and API are revision-safe.
- [ ] DatabaseProfile/Provisioner/Secret Store create isolated Runtime DB and role.
- [ ] Runtime migration runs once before process start and preserves failure evidence.
- [ ] PM2 Adapter uses Fork Mode, allowlists entry/cwd/env/name and cannot manage other processes.
- [ ] Runtime supports stable instance/deployment identity and Secret files.
- [ ] Reconcile converges desired state; PM2 online is not treated as ready.
- [ ] PMS outage does not stop running Runtime; crash recovery uses PM2 + Runtime persistence.
- [ ] Identity check, official Catalog discovery and Registry no-op revisions work.
- [ ] UGV/NPC/HA provider platform E2E are truthful about qualification.
- [ ] Console shows Provider/Config/Runtime/Catalog/Registry/Audit without leaking Secrets.
- [ ] Security/fault tests pass; SDAR Interop is either executed or explicitly blocked without fake certification.
- [ ] 50 Goal 2 tasks PASSED and `pnpm verify:platform` passes for available environment.
