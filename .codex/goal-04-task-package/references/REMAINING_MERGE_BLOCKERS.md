# Remaining Merge Blockers after Goal 03

## PM2 production binding

- `@sdar/pm2-runtime-adapter` lacks a pinned `pm2` dependency.
- No production `createPm2JavascriptApi()` bridge exists.
- Real PM2 E2E invokes `pnpm dlx pm2` and bypasses production Manager/Lifecycle code.
- Online process handling does not compare Runtime Version, Config Revision or Bootstrap Checksum.

## PMS Worker production composition

- Bootstrap only registers Provider Package Sync.
- Runtime Database Preparation and Runtime Reconciler exist as components but are not wired into the production Worker.
- Release Resolver, Bootstrap Renderer, Secret Store, PM2 Manager, Lifecycle, Health, Identity and Catalog/Registry are not assembled together.
- Worker configuration lacks secure production paths and timeouts.

## Continuous reconciliation

- RuntimeDeployment is enqueued on create/command, but there is no periodic scanner to restore missing reconcile work after completion, crash or long-running ACTIVE/DEGRADED states.
- The scheduler must reuse the existing Job Lease table and database time; no second scheduler platform may be added.

## Qualification and release

- No full production lifecycle test proves API intent through Worker, PM2, Runtime Registration, Catalog/Registry and ACTIVE.
- Final CI must qualify worker/PM2 lifecycle and Provider regressions.
- Root package still identifies the Runtime RC rather than Platform 0.1.0.
- Release Manifest and Handoff still contain commit placeholders and stale source Commit values.
