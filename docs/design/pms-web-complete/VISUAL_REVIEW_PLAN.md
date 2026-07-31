# Visual Review Plan

Required viewports are 1440×900 and 1280×720. The Playwright screenshot specification covers Dashboard, Provider, Runtime, Configuration, Resource, Catalog, Registry, Operations, Incident, Change, Audit, Deferred, System, and 404 surfaces.

Acceptance checks:

- no horizontal overflow at 1024 px or wider;
- consistent page header, panel, table, badge, timeline, dialog, drawer, form, code and diff patterns;
- keyboard-visible actions and explicit disabled reasons;
- non-color status labels;
- no console errors or uncontrolled network calls in Mock mode.

Screenshots were not generated in this execution container because Playwright dependencies could not be installed. The exact capture suite is `e2e/product-screenshots.spec.ts`.
