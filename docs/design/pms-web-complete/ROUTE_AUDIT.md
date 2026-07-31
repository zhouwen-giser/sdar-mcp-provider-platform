# Route Audit

The formal browser router registers every route in `src/router.ts`. It uses layout routes, lazy feature imports, route error boundaries, deep-link compatible browser history, explicit redirects, a wildcard 404, and development-only prototype routes.

| Metric | Count |
|---|---:|
| Public routes | 121 |
| Internal routes | 2 |
| Total inventory | 123 |
| FROZEN_API | 37 |
| WEB_COMPOSED | 20 |
| CLIENT_ONLY | 46 |
| DEFERRED | 18 |

Static verification confirms no public route uses `GenericRoute`, `PlatformPage`, or `StructuredPlaceholder`. Unknown URLs render the Not Found page instead of falling back to Dashboard. `/_prototype/*` is registered only when `import.meta.env.DEV` is true.
