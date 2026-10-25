# ADR 014 — native public results and first scheduled binding

Accepted for isolated candidate implementation, 2026-10-25.

The frozen Runtime removes reserved root result fields. Keep native DTO validation/storage exact;
publish public catalog 1.0.1 matching the actual wire envelope and retain the historical 1.0.0 pin.
Do not alter frozen result projection or migrations. A retained-report evidence item attests the
exact persisted report and its explicit gaps, without asserting spatial coverage.

A valid scheduled Start ACK can carry revision zero. Previously the generic duplicate guard
ignored it while the native device was already running; Runtime retained no external execution ID,
TaskBusiness was unavailable and cancellation failed identity validation. The guarded scheduled
admission now permits equal revision only for its first, still-unbound execution binding. Subsequent
same/stale revisions remain ignored and all identity/CAS/claim checks remain required.

Real PostgreSQL/formal MCP tests verify timely binding, Context access, native cancellation and
released occupancy. Joint SDAR validation uses exact governance, confirmation and immutable task
identity; catalog/profile drift rejects before Binding. Deployment/field source qualification remains
open; no running 19100/19101 instance is switched by this change.

Cancellation before the scheduled claim is committed locally under the same row fence, without
Provider dispatch. Cancellation during an in-flight Start retains the schedule claim and intent;
commands wait for the reconciled external identity. Initial binding preserves STOPPING. Explicit
admission absence/rejection may settle an unstarted cancellation; an uncertain ACK cannot take
that path or trigger another start. Formal tests hold the real gRPC Start ACK while native EO runs,
then verify exactly one scan, acknowledged cancel and released occupancy.
