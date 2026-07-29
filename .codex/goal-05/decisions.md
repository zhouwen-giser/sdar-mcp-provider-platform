# Goal 05 Decisions

- G5-P1-B01: `apps/pms-worker/test/production-composition.test.ts` and
  `apps/pms-worker/test/runtime-composition-contract.test.ts` are updated outside the card's
  enumerated test paths because the removed global-token property made the all-repository mandatory
  typecheck fail. The edits only migrate existing fixtures to the new credential-root contract and
  add no production behavior.
- G5-P1-B01: `docs/review/GOAL05_BASELINE.md` and `docs/review/GOAL05_SCOPE_LOCK.md` are normalized
  by the mandatory repository-wide Prettier gate. They contain no semantic change from G5-P0-B01.
- G5-P3-B01: `apps/pms-web/tsconfig.json` enables the already-pinned Node type declarations because
  the task-required repository-owned static server is compiled in the same package as the browser
  entry. This is a type-only build setting required by `apps/pms-web/src/server.ts`; it adds no
  dependency or browser runtime authority.
