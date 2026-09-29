# UGV task business Artifact contract (`1.0-rc2` development)

`TaskArtifactSchema` in `packages/vehicle-provider-core/src/task-business-artifact.ts` is the runtime validator and TypeScript source. `protocol/task-business/v1/artifact.schema.json` is generated from it. The local Store now reads exact versions and stored content bytes. Public Runtime/Adapter read methods remain separate integration work.

## Identity, type and availability

An Artifact belongs to one verified Task/Execution identity and has a stable `artifactId` plus positive revision. Its `artifactType` is one of ten types: `navigation.destination`, `navigation.route`, `navigation.trajectory`, `navigation.waypoints`, `recon.area`, `recon.coverage_plan`, `recon.current_footprint`, `recon.covered_area`, `target.object`, or `target.track`. Type-specific properties and allowed semantics are validated at runtime. A candidate route is not an adopted route; a route is planned while a trajectory is observed. Estimated/nominal footprint is derived, identifies its model, and does not claim occlusion-aware visibility.

`available` requires typed spatial content or an opaque, version-bound stored content reference. `empty` requires a completed read time and reason, and has no content. `not_produced_yet`, `not_supported`, and `unavailable` require a reason and need no content or invented properties. A one-sample navigation trajectory uses `Point` with `sampleCount=1`; `LineString` requires at least two samples. No navigation mode is forced to have a destination Artifact.

## Geometry and clocks

`geojson` uses `OGC:CRS84` with `[longitude, latitude, altitude?]`, finite coordinates and longitude/latitude bounds. `local_geometry` retains `frameId`, metric unit, axis convention and optional transform reference; its numbers are not interpreted as longitude and latitude. Point, MultiPoint, LineString, MultiLineString, Polygon and MultiPolygon have distinct shapes. Lines need two positions; polygon rings need four entries, closure and three distinct vertices. JSON Schema encodes coordinate bounds and array lengths; the canonical Zod runtime validator also enforces ring closure and cross-field semantics that standard JSON Schema cannot express.

`target.object` may contain an image observation with only pixel/normalized point or box and no geographic location. Its geographic or local representation, when available, stays under the same Artifact ID in `representations`. `targetId` equals that ID. An observation timestamp states its clock domain: UTC time or simulator/device relative milliseconds with a clock ID. Relative time is never formatted as UTC.

Coverage properties carry an `areaRevision`, grid frame, origin, cell size, denominator count and, for covered area, numerator count. Publishing code must derive geometry and counts from the same area/grid basis and bump revisions when that basis changes; the contract rejects numerator greater than denominator. Source production and shared-store verification remain later tasks.

## Content read and version policy

The Store selects an immutable version by the bound execution scope, Artifact ID and exact revision. A latest request resolves the highest revision first and pins it for content read. `prepareArtifactContentRead` checks identity, exact ID/revision, availability and reference expiry on the stored Artifact, for main content or a named representation. Its output is inline content or a **server-owned** opaque handle with media type, byte size and SHA-256. `readArtifactContentBytes` follows that handle in the same scoped Store, verifies metadata, length and hash, and returns actual bytes. Old Artifact versions remain addressable after supersession or Context finalization; the Store has no automatic deletion policy for their metadata.

Clients supply no URL for server fetching. A handle permits only letters, digits, underscore and hyphen; `https://...` is invalid. `ARTIFACT_SCOPE_MISMATCH`, `ARTIFACT_REVISION_NOT_FOUND`, `ARTIFACT_NOT_AVAILABLE`, `ARTIFACT_REPRESENTATION_NOT_FOUND`, and `ARTIFACT_CONTENT_EXPIRED` are distinct results. A missing stored version and an expired content object never become empty success. `expiresAt` is the content read cutoff, including after Context finalization. Physical byte purge is an owner retention operation that must not erase or reinterpret the Artifact version; no purge job is implemented here. The public Runtime/Adapter path for these Store methods is UGVB-021/022 work and is not yet available.
