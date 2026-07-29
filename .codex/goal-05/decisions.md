# Goal 05 Decisions

- G5-P1-B02: `apps/pms-web/src/App.tsx` receives only the route-to-feature wiring required to make
  the task-scoped Provider, Resource and Dashboard modules reachable. Business implementation
  remains under the task's allowed feature paths.
- G5-P1-B03: `apps/pms-web/src/App.tsx` receives the same minimal route wiring for Runtime and
  recovery feature modules. No Runtime, Worker, PM2 or backend package is touched.
- G5-P1-B04: `apps/pms-web/src/App.tsx` receives only Configuration route wiring; the complete
  editor and publishing interaction remains inside the task-scoped frontend feature.
