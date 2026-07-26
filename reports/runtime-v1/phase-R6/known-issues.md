# Phase R6 Known Issues

- R7 recovers pending control commands and reconciles every nonterminal state after Runtime/Adapter/database faults.
- Optional notifications/tasks transport is not enabled; the durable outbox and independent publication accounting are implemented, and `tasks/get` does not depend on delivery.
- Local Docker/PostgreSQL remains unavailable; remote CI is the authoritative database/Compose gate.
