# React Router RSC advisory disposition

## Decision

`GHSA-qwww-vcr4-c8h2` is ignored by the high-severity dependency audit until a patched `react-router-dom` release is available from the configured npm registry.

## Scope evidence

- The advisory affects React Server Components action execution.
- PMS Web is a Vite single-page application using browser routing.
- The application has no RSC server entry, React Router framework server adapter, server action, or `react-server` condition.
- Repository searches for RSC request handlers and server-entry APIs return no PMS Web implementation matches.

The exception is exact to this GHSA. Other high or critical advisories still fail `pnpm audit:dependencies`.

## Maintenance

The npm registry currently resolves `react-router-dom` to `7.18.2`, while the advisory reports the patched line as `8.3.0`. Remove the exact ignore and upgrade once a compatible patched package is published, then rerun Web unit, build, E2E and dependency audit gates.
