# Phase R3 Known Issues

- Admission intents deliberately remain `UNCERTAIN` after response-loss or publication failure. Durable Reconcile resolves these in R4/R7; R3 proves the intent is retained and no taskId leaks.
- P1 availability/idempotency, scheduling/timing, input/update/cancel, observation streams, and background reconcile are later planned phases.
- MCP `tasks/result` is delivered with the full control/result surface in R6; R3 exit requires `tasks/get` and validates it with the official client.
- Local Docker/PostgreSQL execution is unavailable because the current user cannot access the Docker socket. GitHub Actions supplies real PostgreSQL and Compose evidence; no test is disabled or silently skipped.
