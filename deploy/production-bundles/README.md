# Production deployment bundles

This directory contains the committed deployment inputs copied into the two offline production
bundles. `ugv/` and `npc-tank/` are source templates: the bundle builder supplies the immutable
application revision and resolved PostgreSQL digest in a read-only `.bundle-images.env`.

Build hosts require Node.js 22, Git, GNU tar/gzip/zip, Docker Engine, and Docker Compose v2. The
source tree must be a clean committed `HEAD`.

Validate both package layouts without Docker:

```bash
node scripts/production-bundles/build.mjs --stage-only --output-dir /tmp/sdar-bundle-stage
node scripts/production-bundles/verify.mjs \
  /tmp/sdar-bundle-stage/sdar-ugv-production-stage-only.zip
node scripts/production-bundles/verify.mjs \
  /tmp/sdar-bundle-stage/sdar-npc-tank-production-stage-only.zip
```

Build the five application images per product, resolve and archive PostgreSQL, and create the final
deliveries:

```bash
node scripts/production-bundles/build.mjs
```

Final output is written to `reports/production-bundles/delivery/`:

- `sdar-ugv-production-delivery.zip`
- `sdar-npc-tank-production-delivery.zip`
- one `.sha256` sidecar for each ZIP

Each ZIP is independent and contains its product deployment directory, six offline images in
`images/images.tar.gz`, JSON and TSV image manifests, `VERSION`, `SHA256SUMS`, the repository
license, the Runtime-scope SBOM, and the complete exportable `git archive` source for its exact
revision. The source archive follows committed `.gitattributes export-ignore` rules. It contains no
`.git` directory or real `.env`.

The deployment host needs Bash, Docker Engine with Compose v2, OpenSSL, and `sha256sum`; it does not
need Git, Node.js, pnpm, the original repository, or access to an image registry. Stage-only ZIPs
have `DEPLOYABLE=false`, contain no real images, use a distinct filename, and are rejected before
any Docker mutation.

The builder and verifier fail closed on dirty source, an incomplete source archive, unexpected or
Mock runtime images, Compose `build` fields, non-`never` pull policy, incorrect service inventory,
real `.env`/private-key paths, recognizable secret material, unsafe archive paths, checksum drift,
image identity drift, missing non-root users or healthchecks, and wrong production provider/profile
labels. Both products intentionally use the `strict-intranet-plaintext` transport profile: HTTP,
MQTT, Adapter gRPC, and Provider telemetry are unencrypted, and the operator must keep every bound
port and upstream endpoint inside an isolated internal network.

## ARM64 source-build deliveries

The ARM64 variant intentionally contains no Docker image archive and does not publish or pull SDAR
application images from a public registry. It carries the exact committed source archive. On a
native Linux ARM64 deployment host, its verified `build-images.sh` pulls digest-pinned official
Node/PostgreSQL ARM64 images and builds the five product application targets locally before the
unchanged `--no-build --pull never` Compose startup path is allowed.

Generate both ARM64 source-build ZIPs from a clean committed `HEAD`:

```bash
node scripts/production-bundles/build-arm64-source.mjs
```

Outputs are written to `reports/production-bundles/delivery/`:

- `sdar-ugv-production-arm64-source-build-delivery.zip`
- `sdar-npc-tank-production-arm64-source-build-delivery.zip`
- one `.sha256` sidecar for each ZIP

The deployment host does not need Git, Node.js, or pnpm, but its Docker daemon must run natively on
ARM64 with BuildKit enabled. The first build requires HTTPS access to Docker Hub, the npm registry,
and the grpc-tools binary host. Repository-review tools with additional release-asset downloads are
excluded from the production image build. This build-time network requirement does not change the
plaintext-only internal runtime transport profile.
