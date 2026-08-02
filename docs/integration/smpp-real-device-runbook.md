# SMPP real-device runbook

1. Confirm `main` baseline and create `codex/ha-real-device-preparation`.
2. Start the controlled PostgreSQL Runtime database and the vendor-managed Adapter processes.
3. Run `pnpm ha:real:preflight`.
4. Run the component contract gates: `pnpm test:ha-climate:protocol-v1` and `pnpm test:ha-light:protocol-v1`.
5. For a write qualification, set the two safety-gate variables and use a unique run ID. Never pass a token as an environment variable.
6. Observe `tasks/get` and Home Assistant state before classifying a Task as completed. HTTP 200 alone is not completion evidence.
7. Stop on an uncertain or safety-blocked operation. Do not automatically retry a device write beyond the run budget.

The frozen Runtime profile exposes `server/discover`, `tools/list`, `tools/call`, `tasks/get`, notifications, and the frozen Task control methods. It does not expose the legacy `initialize` or `tasks/result` methods; reports must preserve that compatibility distinction.
