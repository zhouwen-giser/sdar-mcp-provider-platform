# SMPP real-device runbook

1. Confirm `main` baseline and create `codex/ha-real-device-preparation`.
2. Start the controlled PostgreSQL Runtime database and the vendor-managed Adapter processes.
3. Run `pnpm ha:real:preflight`.
4. Run the component contract gates: `pnpm test:ha-climate:protocol-v1` and `pnpm test:ha-light:protocol-v1`.
5. For a write qualification, set the two safety-gate variables and use a unique run ID. Never pass a token as an environment variable.
6. Observe `tasks/get` and Home Assistant state before classifying a Task as completed. HTTP 200 alone is not completion evidence.
7. Stop on an uncertain or safety-blocked operation. Do not automatically retry a device write beyond the run budget.

For the formal lab path, run the PMS onboarding and Registry-backed drivers only after both Runtime Deployments report `ACTIVE` and `/health/ready` is ready. The live continuation reports are under `reports/real-device-preparation-continuation/`; a direct application Reconcile result must not be relabelled as completed Worker job evidence.

For a current live snapshot, run the Registry contract probe, the Registry-backed read E2E, and the continuation view generator in that order. The generator preserves `blocked`, `partial`, and `unverified` statuses; do not edit those statuses to obtain a readiness value. If Home Assistant reports any configured resource as `unavailable`, stop all device writes, diagnose the integration, and rerun the read-only preflight before resuming.

The frozen Runtime profile exposes `server/discover`, `tools/list`, `tools/call`, `tasks/get`, notifications, and the frozen Task control methods. It does not expose the legacy `initialize` or `tasks/result` methods; reports must preserve that compatibility distinction.
