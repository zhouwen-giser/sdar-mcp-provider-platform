# Complete real navigation payload samples

`manifest.json` pins the successful public capture, its replay evidence and all
eight NDJSON files. The run is Task c572b7d9-468c-45d7-a657-ae21b8a34201, missions
47568 → 47569 → 47570. It used production Runtime/Provider entrypoints, actual
software planning/device calls and a disposable complete GOWM SMPP installation.

| File                           | Records and use                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------- |
| snapshots.ndjson               | 19 full validated Context values, exact object versions and public resume cursors |
| notifications-initial.ndjson   | 7 original parsed JSON-RPC business notifications                                 |
| notifications-recovered.ndjson | 31 original notifications after both processes restarted                          |
| stream-initial.ndjson          | Complete initial probe output, with Context and notification payloads             |
| stream-recovered.ndjson        | Complete recovered probe output in its original order                             |
| intervention-1.ndjson          | First guarded command, receipt, application and exact objects                     |
| intervention-2.ndjson          | Second command and its lifecycle records                                          |
| task-result.ndjson             | Public terminal Task result and completion evidence                               |

Stream files preserve their own order. Standalone snapshot and Intervention
files are separate observations; no total order across files is invented. The
public cursor is used for listening, while the source cursor is provenance.
Snapshots and their exact versions must be hydrated before applying a notification.
Receipt acceptance remains distinct from adoption/application.

The actual parsed notification objects are retained, including rawPayload.
They are selected, normalized and applied Task business events, not a complete
HTTP/SSE session dump. Unrelated/rejected/duplicate messages, framing bytes,
headers and snapshot capability tokens are excluded. No missing payload is
reconstructed. The separate original capture is preserved for hash verification.

Run `scripts/task-business/replay-public-navigation.mjs` as documented in
`../../V-PUBLIC-PAYLOADS.md`. It contacts no service and dispatches no command.
Its duplicate checks are offline consumer checks, not new device retries.
External SDAR, recon/Input acceptance and remote deployment remain unqualified.
