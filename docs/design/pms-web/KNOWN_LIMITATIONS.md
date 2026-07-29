# Known limitations

- Data and operations exist only for the lifetime of the browser page. A full reload resets them.
- There is no authentication, authorization, tenancy, persistence, API client or production
  transport.
- Operation progression is manual and deterministic; it does not model production timing,
  retries, cancellation or concurrency.
- Runtime, PM2, Worker, database, Registry and MCP states are representative projections only.
- Search, sorting and advanced table pagination are not implemented.
- P1 pages are structured review surfaces, not complete workflows.
- The layout targets desktop product review at 1440×900 and 1280×720; mobile is out of scope.
- Accessibility foundations include labels, keyboard focus, Escape drawer closing and focus return,
  but a dedicated assistive-technology audit remains future work.
- The E2E configuration reuses `/usr/bin/google-chrome`; another environment may need to change
  `launchOptions.executablePath`.
