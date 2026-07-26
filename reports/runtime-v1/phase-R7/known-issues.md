# Phase R7 Known Issues

- R8 replaces example Adapter process-memory execution binding with durable language-specific stores and runs identical P0-P4 scenarios against TypeScript and Python.
- HS256 is the required tested JWT mode for V1.0 RC; the resolver interface permits a production deployment to supply another verifier without changing Task authorization semantics.
- Outbox delivery transport remains deployment-specific; metrics and durable retry accounting are present, and delivery failure cannot affect Task queries.
- Local Docker/PostgreSQL remains unavailable; remote CI is authoritative.
