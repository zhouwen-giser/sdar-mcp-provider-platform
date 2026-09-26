# UGV task business development contract `1.0-rc2`

The canonical source is the Zod schemas in `packages/vehicle-provider-core/src/task-business-*.ts` and the Operation profile schema in `packages/adapter-protocol/src/task-business-profile.ts`. TypeScript types derive from those schemas. Run `pnpm task-business:generate` to refresh the JSON Schemas and the positive/negative catalogs; run `pnpm task-business:check` to fail on drift. The check command does not write artifacts.

`examples/positive-catalog.json` contains complete synthetic contract objects, including every feedback kind, geographic geometry shape, local geometry, image observations, exact-version content references, Action, Required Input, Intervention and commands. `examples/negative-catalog.json` contains messages rejected by the canonical parser. NaN and infinities are tested in memory because JSON cannot represent them. These examples are not captured device or simulation traffic.

JSON Schema covers structural constraints. Canonical Zod parsing and pure preflight helpers additionally enforce semantic rules, including polygon closure, geometry/type match, exact reference revision, expiry, responder identity and command guards. An unknown optional feedback kind is preserved as opaque data only. Unsupported versions and required unknown kinds fail. Actual persistence, Runtime wiring, SDAR integration and release qualification remain separate work.

Version transitions preserve a Required Input's `requestedAt` and `deadlineAt`, and an Intervention's `createdAt` and `validUntil`. A changed validity window requires a new request key or Intervention entry; advancing the existing revision cannot renew an expired entry.
