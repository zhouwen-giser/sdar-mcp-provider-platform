# Phase R5 Known Issues

- R6 generalizes the deadline safe-stop path into user cancellation, duplicate command sequencing, pause/resume, input updates, and complete observation/outbox handling.
- R7 adds retry/backoff and startup-wide Reconcile for Adapter unavailability during a deadline request; R5 never fabricates a terminal result when that request is uncertain.
- Runtime polling is a liveness trigger only. PostgreSQL due rows, claim expiry, and deterministic ticks are the source of correctness.
- Local Docker/PostgreSQL remains unavailable; remote CI is the authoritative database/Compose gate.
