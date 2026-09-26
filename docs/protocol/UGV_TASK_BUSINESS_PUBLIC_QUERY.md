# UGV public TaskBusiness reads (`1.0-rc2` development)

The frozen `/mcp` endpoint handles `io.sdar/taskBusiness/context/get`, `io.sdar/taskBusiness/snapshotParts/get`, and `io.sdar/taskBusiness/artifacts/get` when an Operation advertises `io.sdar/taskBusiness` in its tool `_meta`. `server/discover` lists the available extension methods and their query/result JSON Schemas only when a business profile and Runtime read service are available. It lists `snapshotParts/get` only if at least one Operation Profile declares `methods.snapshotPartGet`; each read still checks the selected Task's persisted Operation Profile. These are SDAR extension methods, not official MCP `tasks/*` methods. They require the frozen protocol headers (including `mcp-name: <taskId>`), Tasks capability, and `io.sdar/taskBusiness` client capability with `profileVersion: 1.0-rc2`.

Every read resolves the persisted authorized Task and saved Operation Snapshot. Optional `externalExecutionId`, `resourceId`, `executionMode`, and `simulationId` are consistency assertions; they cannot select another Execution or scene. Context queries accept `maxPageBytes` from 1,024 to 1,048,576 (default 65,536) and an opaque `pageCursor`. Artifact queries accept an exact positive `revision` or omit it for latest, an optional `representationName`, and bounded content offset/size with `includeContent: true`. Bytes are returned as base64, with media type, SHA-256, total bytes and optional next offset. The Runtime checks the selected immutable `content_ref`, total size, digest metadata and chunk offsets; it hashes a complete single-chunk response. The client must still hash the assembled bytes when reading multiple chunks.

## Snapshot then public stream

The Runtime reads the **public** Business Events generation and sequence `C`, reads the Adapter's committed Context page at revision `R`, and checks the generation again before returning. The first page's signed continuation cursor carries `C`, `R`, Task, auth hash and Adapter cursor. Every page also returns a signed `snapshotToken` for reading descriptors at that revision. Later pages reuse `C` even if the public stream advances. The client must fetch all pages until `snapshot.nextCursor` is absent, resolve any descriptors, then call the existing `io.sdar/businessEvents/listen` using `params.cursor = resumeFrom`. The public stream can include other Tasks; the consumer filters by verified Task identity and deduplicates overlapping changes by message ID and object revision. `sourceCursor` is provenance and must never be sent as this public resume cursor.

Example response for a first page (IDs and content are illustrative):

```json
{
  "jsonrpc": "2.0",
  "id": "context-1",
  "result": {
    "resultType": "complete",
    "profileVersion": "1.0-rc2",
    "snapshotToken": "<opaque signed descriptor token>",
    "snapshot": {
      "contextRevision": 7,
      "context": {
        "contextRevision": 7,
        "identity": { "taskId": "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1004" }
      },
      "objects": [],
      "objectDescriptors": [],
      "nextCursor": "<opaque signed page cursor>"
    },
    "resumeFrom": {
      "streamId": "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1007",
      "afterSequence": "10"
    }
  }
}
```

The example `context` is abbreviated and is not a valid full Context contract fixture. Send `pageCursor` and the same `maxPageBytes` on the next `context/get` call; the next page returns the same `resumeFrom` and `contextRevision`. `resultType: complete` means that JSON-RPC call completed; `nextCursor` determines whether the snapshot has more pages. After the last page, the existing SSE call uses:

```json
{
  "method": "io.sdar/businessEvents/listen",
  "params": {
    "cursor": {
      "streamId": "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1007",
      "afterSequence": "10"
    },
    "_meta": { "...": "frozen protocol metadata and Business Events capability" }
  }
}
```

## Large Context and object versions

The Adapter emits `contextDescriptor: { revision, sizeBytes, readMethod: "getContext" }` or `objectDescriptors: [{ ref, sizeBytes, readMethod: "getObjectVersion" }]` when an exact JSON value does not fit the requested page. The Context or object is omitted from that page, never silently truncated. `snapshotParts/get` uses the page's `snapshotToken`, the same `taskId`, an optional exact `objectRef` for an object descriptor, `offset` (default 0), and `maxBytes` from 1 to 1,048,576 (default 65,536). Omit `objectRef` to read Context. The token fixes Task, authorization, public stream generation and Context revision. The Provider only reads object versions listed by that Context. Each response contains `part: { encoding: "base64", bytes, totalBytes, sha256, offset, nextOffset? }`; `totalBytes` and `nextOffset` are decimal strings. Read until `nextOffset` is absent, require contiguous offsets and a stable total size and digest, compare the descriptor size, then hash and parse the complete JSON value. For an object, validate its kind, identity, ID and revision against the descriptor and Context reference. The included read-only probe performs those checks before it emits a snapshot or object value.

An invalid or process-local token/cursor, changed Context revision, generation rotation, or expired public replay window returns a structured `reasonCode`; the client restarts the snapshot. Signed tokens currently use a per-process key; a request routed to a different Runtime process fails closed and must restart the snapshot. This does not claim load-balanced token continuity. The Runtime validates the full Context before returning each public page, including when the Context itself is a descriptor. It validates each inline object and descriptor reference; the consumer validates the complete bytes of a multi-chunk object after assembly. A single-chunk part is hashed and schema checked by Runtime as well.

The Runtime validates the full Context and every included object version against the TaskBusiness schemas, the authorized Task/Execution/Provider/resource/operation/scene binding, and an exact Context reference. An Artifact read repeats the exact identity and revision check. A foreign, malformed, duplicate or unreferenced object is rejected; the response is not treated as a partial snapshot to be merged by the client.

The local HTTP wire tests use a stubbed Task repository, Adapter and generation reader. A separate isolated native PostgreSQL test reads over 1 MiB Context and Action values through the UGV Adapter gRPC server and localhost `/mcp`, including cross-subject and stale-revision rejection. The same native test runs the read-only SMPP probe against those descriptor pages and a committed public SSE event. This is still a mock Device/local test scene, not selected GOWM simulation or external SDAR client acceptance.
