# Goal 09 Known Limitations

Final classification: `BLOCKED`.

1. `pnpm --filter @sdar/pms-api test` executed 128 tests. 127 passed. The remaining test could not create a Windows file symlink and failed with `EPERM` before reaching the implementation assertion. Developer Mode or `SeCreateSymbolicLinkPrivilege` is required to close this gate.
2. Root `eslint.config.js` now supplies `projectService` type information to both `**/*.ts` and `**/*.tsx`, so typed-rule initialization succeeds. The resulting full `pnpm lint` run reports 278 existing rule violations across API, Web and Node scripts; this follow-up does not suppress strict rules or misreport that backlog as green.
3. `pnpm format:check` reports the reviewed baseline itself, including frozen read-only contract and out-of-scope files. Windows `core.autocrlf=true` adds further EOL noise. Reformatting the frozen contract would violate the contract lock; the root Prettier scope/configuration is outside Goal 09.

PostgreSQL and Chrome were available and used; they are not limitations. All Console inject tests, all database-backed Goal 09 tests, Web unit/build checks, Mock browser flows, and the separate API fail-closed browser check passed.

Live browser-to-PMS API integration was not implemented or claimed in Goal 09.
