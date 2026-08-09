# SMPP real-device runbook

1. Confirm `main` baseline and create `codex/ha-real-device-preparation`.
2. Start the controlled PostgreSQL Runtime database and the vendor-managed Adapter processes.
3. Run `pnpm ha:real:preflight`.
4. Run the component contract gates: `pnpm test:ha-climate:protocol-v1` and `pnpm test:ha-light:protocol-v1`.
5. For a write qualification, set the two safety-gate variables and use a unique run ID. A climate path that can change power—including `climate_set_power` and `climate_set_hvac_mode` from off—additionally requires `ALLOW_CLIMATE_POWER_TEST=YES`. Never pass a token as an environment variable.
6. Observe `tasks/get` and Home Assistant state before classifying a Task as completed. HTTP 200 alone is not completion evidence.
7. Stop on an uncertain or safety-blocked operation. Do not automatically retry a device write beyond the run budget.

For the formal lab path, run the PMS onboarding and Registry-backed drivers only after both Runtime Deployments report `ACTIVE` and `/health/ready` is ready. The authoritative closeout reports are under `reports/real-device-closeout/`; a direct application Reconcile result must not be relabelled as completed Worker job evidence.

For a current live snapshot, run the Home Assistant preflight, Registry contract probe, Registry-backed read E2E, and `pnpm report:ha-real-closeout` in that order. The generator preserves `blocked`, `partial`, and `unverified` statuses and exits non-zero while overall SDAR readiness is blocked; do not edit those statuses to obtain a readiness value. If Home Assistant reports any configured resource as `unavailable`, stop all device writes, diagnose the integration, and rerun the read-only preflight before resuming.

Never wait inside an automated driver and then issue the opposite climate power operation. If the five-minute interval is still active, record `manual_restore_required`, report the original and current state, and stop further climate writes.

The frozen Runtime profile exposes `server/discover`, `tools/list`, `tools/call`, `tasks/get`, notifications, and the frozen Task control methods. It does not expose the legacy `initialize` or `tasks/result` methods; reports must preserve that compatibility distinction.
