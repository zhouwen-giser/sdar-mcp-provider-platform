# Prototype technical plan

## Architecture

The rebuilt application stays in `apps/pms-web`. It uses TypeScript, browser-native DOM rendering,
CSS variables and small state/reducer modules so the prototype remains dependency-light and
testable with Vitest.

```text
UI pages/components
        |
PmsWebDataSource interface
        |
MockPmsWebDataSource → ScenarioBuilder → fixtures
        |
PrototypeOperation clock/reducer
```

Pages never import fixtures. The mock data source owns scenario selection, query projections and
in-memory simulated mutations. Timers are injected so tests can advance operations without wall
clock waits.

## Planned source areas

- `src/data`: interface, mock source, fixtures and scenario builder
- `src/prototype`: scenario store, operation reducer/clock and shared state
- `src/components`: shell, table, feedback, overlays, wizard and diff primitives
- `src/pages`: route-level compositions
- `src/router.ts`: typed route matching and URL search synchronization
- `src/styles.css`: tokens, layout, components and viewport behavior
- `test`: unit, component and flow tests
- `e2e`: browser acceptance for five workflows

## Scenario contract

The scenario query parameter is preserved across navigation. Production builds may keep scenario
support in code for deterministic screenshots, but the visible switcher renders only in prototype
development mode.

## Verification strategy

1. Unit: data source, scenario builder, operations, reducers and formatting.
2. Component: drawer, dialog, wizard, diff and operation panel.
3. Flow: all five workflows with deterministic operation advancement.
4. Browser: no console errors, no application network calls, 1440×900 and 1280×720 screenshots.
5. Boundary scripts: no forbidden transport/auth implementation and no backend changes.

## Delivery

The final handoff includes route/component inventories, interaction notes, screenshot index,
browser evidence and a future API gap list. The branch is proposed to `main` as a Draft PR and is
not merged automatically.
