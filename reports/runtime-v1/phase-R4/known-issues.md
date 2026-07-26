# Phase R4 Known Issues

- Scheduled-call idempotency is completed with the durable scheduler in R5; immediate synchronous/task calls are complete in R4.
- Startup-wide background scanning and non-idempotent uncertain-intent recovery remain R7 scope. R4 recovers a pending idempotent invocation on the next duplicate request.
- Availability is predictive and intentionally creates no reservation. StartOperation remains the final authority.
- Local PostgreSQL/Docker access remains unavailable as already reported; GitHub Actions is the real database/Compose gate.
