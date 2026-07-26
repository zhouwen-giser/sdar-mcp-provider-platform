# H9 Test Results

See `implementation.md` for the complete command/count table. The authoritative H9
implementation runs are push runtime `29544205005`, PR runtime `29544206323`, PR Compose
`29544206369` and PR quality `29544206345`; all passed. The report-containing Head must rerun the
same workflows before it can be considered a tag target.

The only failed local invocation was an initial E2E command missing `TEST_DATABASE_URL`; it
failed during suite collection with no tests run. The command was rerun with the required real
PostgreSQL URL and passed 4/4. This invocation error is not counted as a product failure or
hidden.
