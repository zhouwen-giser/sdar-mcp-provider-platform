# Goal 09 Known Limitations

Final classification: `BLOCKED`.

1. `pnpm --filter @sdar/pms-api test` executed 128 tests. 127 passed. The remaining test could not create a Windows file symlink and failed with `EPERM` before reaching the implementation assertion. Developer Mode or `SeCreateSymbolicLinkPrivilege` is required to close this gate.

The root `pnpm lint`, `pnpm format:check` and `pnpm typecheck` gates now pass. Typed ESLint rules use project-service information for both `**/*.ts` and `**/*.tsx`; scoped transitional overrides cover tests, scripts and the current PMS Web implementation. Prettier excludes the frozen Console contract and generated Web contract types, whose locked hashes remain unchanged.

PostgreSQL and Chrome were available and used; they are not limitations. All Console inject tests, all database-backed Goal 09 tests, Web unit/build checks, Mock browser flows, and the separate API fail-closed browser check passed.

Live browser-to-PMS API integration was not implemented or claimed in Goal 09.
