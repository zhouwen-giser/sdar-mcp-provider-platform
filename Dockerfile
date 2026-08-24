ARG NODE_BASE_IMAGE=node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

FROM ${NODE_BASE_IMAGE} AS build
ARG VITE_PMS_DATA_MODE=api
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml .npmrc ./
COPY apps/runtime/package.json apps/runtime/package.json
COPY apps/home-assistant-climate-provider/package.json apps/home-assistant-climate-provider/package.json
COPY apps/home-assistant-light-provider/package.json apps/home-assistant-light-provider/package.json
COPY apps/ugv-provider-adapter/package.json apps/ugv-provider-adapter/package.json
COPY apps/npc-tank-provider-adapter/package.json apps/npc-tank-provider-adapter/package.json
COPY apps/mock-ugv-device-mcp/package.json apps/mock-ugv-device-mcp/package.json
COPY apps/mock-ugv-mqtt-publisher/package.json apps/mock-ugv-mqtt-publisher/package.json
COPY apps/mock-npc-tank-device-mcp/package.json apps/mock-npc-tank-device-mcp/package.json
COPY apps/mock-npc-tank-mqtt-publisher/package.json apps/mock-npc-tank-mqtt-publisher/package.json
COPY apps/pms-api/package.json apps/pms-api/package.json
COPY apps/pms-web/package.json apps/pms-web/package.json
COPY apps/pms-worker/package.json apps/pms-worker/package.json
COPY packages/adapter-protocol/package.json packages/adapter-protocol/package.json
COPY packages/catalog-manager/package.json packages/catalog-manager/package.json
COPY packages/configuration-center/package.json packages/configuration-center/package.json
COPY packages/conformance-testkit/package.json packages/conformance-testkit/package.json
COPY packages/database-migration-runner/package.json packages/database-migration-runner/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/mcp-protocol/package.json packages/mcp-protocol/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/operation-registry/package.json packages/operation-registry/package.json
COPY packages/persistence-postgres/package.json packages/persistence-postgres/package.json
COPY packages/pm2-runtime-adapter/package.json packages/pm2-runtime-adapter/package.json
COPY packages/pms-application/package.json packages/pms-application/package.json
COPY packages/pms-console-api-contract/package.json packages/pms-console-api-contract/package.json
COPY packages/pms-console-api-testkit/package.json packages/pms-console-api-testkit/package.json
COPY packages/pms-domain/package.json packages/pms-domain/package.json
COPY packages/pms-persistence-postgres/package.json packages/pms-persistence-postgres/package.json
COPY packages/postgres-provisioner/package.json packages/postgres-provisioner/package.json
COPY packages/task-engine/package.json packages/task-engine/package.json
COPY packages/provider-adapter-kit/package.json packages/provider-adapter-kit/package.json
COPY packages/provider-package-registry/package.json packages/provider-package-registry/package.json
COPY packages/registry-snapshot/package.json packages/registry-snapshot/package.json
COPY packages/runtime-config-client/package.json packages/runtime-config-client/package.json
COPY packages/runtime-configuration-contract/package.json packages/runtime-configuration-contract/package.json
COPY packages/runtime-deployment/package.json packages/runtime-deployment/package.json
COPY packages/runtime-migration-runner/package.json packages/runtime-migration-runner/package.json
COPY packages/runtime-registration/package.json packages/runtime-registration/package.json
COPY packages/secret-store/package.json packages/secret-store/package.json
COPY packages/vehicle-provider-core/package.json packages/vehicle-provider-core/package.json
COPY packages/vehicle-mqtt-ingress/package.json packages/vehicle-mqtt-ingress/package.json
COPY packages/vehicle-device-mcp-client/package.json packages/vehicle-device-mcp-client/package.json
COPY examples/mock-adapter-typescript/package.json examples/mock-adapter-typescript/package.json
COPY examples/mock-adapter-python/package.json examples/mock-adapter-python/package.json
# Install the exact lockfile without running repository-review tooling side
# effects. The production compiler only needs these reviewed lifecycle scripts;
# openapi-changes is used by a separate breaking-change gate and otherwise
# downloads an additional GitHub release asset during install.
RUN --mount=type=cache,id=sdar-corepack,target=/root/.cache/node/corepack,sharing=locked \
    --mount=type=cache,id=sdar-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --ignore-scripts --prefer-offline \
      --network-concurrency=8 --store-dir=/pnpm/store \
    && pnpm rebuild esbuild grpc-tools
COPY Dockerfile Dockerfile
COPY scripts/verify-docker-workspace-manifests.mjs scripts/verify-docker-workspace-manifests.mjs
RUN node scripts/verify-docker-workspace-manifests.mjs
COPY . .
RUN --mount=type=cache,id=sdar-corepack,target=/root/.cache/node/corepack,sharing=locked \
    test "$VITE_PMS_DATA_MODE" = api \
    && pnpm build \
    && pnpm --filter @sdar/pms-web build \
    && cp -R dist/packages release-packages \
    && node --input-type=module -e 'import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"; for (const directory of readdirSync("release-packages", { withFileTypes: true })) { if (!directory.isDirectory()) continue; const name = directory.name; const manifest = `packages/${name}/package.json`; if (!existsSync(manifest)) continue; const source = JSON.parse(readFileSync(manifest, "utf8")); writeFileSync(`release-packages/${name}/package.json`, `${JSON.stringify({ name: source.name, version: source.version, private: true, type: "module", main: "./src/index.js", exports: { ".": "./src/index.js" } }, null, 2)}\n`); }' \
    && find dist proto migrations release-packages -exec touch -h -d '@0' {} +

FROM build AS production-dependencies
RUN --mount=type=cache,id=sdar-corepack,target=/root/.cache/node/corepack,sharing=locked \
    --mount=type=cache,id=sdar-pnpm-store,target=/pnpm/store,sharing=locked \
    rm -rf node_modules apps/*/node_modules packages/*/node_modules examples/*/node_modules \
    && CI=true pnpm install --prod --offline --frozen-lockfile \
      --filter='!@sdar/pms-web' --store-dir=/pnpm/store \
    && find node_modules -type f -name '*.map' -delete \
    && find node_modules -type f -iname '*.md' \
      ! -iname 'license*' ! -iname 'notice*' ! -iname 'copying*' -delete \
    && rm -f node_modules/.modules.yaml node_modules/.pnpm-workspace-state-v1.json \
    && find node_modules -exec touch -h -d '@0' {} +

FROM production-dependencies AS ugv-real-production-dependencies
RUN rm -rf node_modules/.pnpm/node_modules/@sdar \
    && touch -h -d '@0' node_modules/.pnpm/node_modules

FROM ${NODE_BASE_IMAGE} AS ugv-real-base
ARG VCS_REF=unknown
ENV NODE_ENV=production
WORKDIR /app
LABEL org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="https://github.com/zhouwen-giser/sdar-mcp-provider-platform" \
      org.opencontainers.image.licenses="Apache-2.0"
COPY --from=ugv-real-production-dependencies --chown=root:root /workspace/node_modules /app/node_modules
COPY --from=build --chown=root:root /workspace/dist/packages /app/dist/packages
COPY --from=build --chown=root:root /workspace/proto /app/proto
COPY --from=build --chown=root:root /workspace/migrations /app/migrations
RUN mkdir -p /var/lib/sdar \
    && chown node:node /var/lib/sdar \
    && touch -d '@0' /var/lib/sdar /app
USER node

FROM ugv-real-base AS ugv-real-runtime
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="SDAR UGV Qualification Runtime" \
      org.opencontainers.image.revision="${VCS_REF}"
COPY --from=build --chown=root:root /workspace/dist/apps/runtime /app/dist/apps/runtime
CMD ["node", "dist/apps/runtime/src/main.js"]

FROM ugv-real-base AS ugv-real-adapter
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="SDAR Real UGV Provider Adapter" \
      org.opencontainers.image.revision="${VCS_REF}"
COPY --from=build --chown=root:root /workspace/dist/apps/ugv-provider-adapter /app/dist/apps/ugv-provider-adapter
COPY --from=build --chown=root:root /workspace/scripts/ugv-simulation /app/scripts/ugv-simulation
CMD ["node", "dist/apps/ugv-provider-adapter/src/main.js"]

FROM production-dependencies AS npc-real-production-dependencies
RUN rm -rf node_modules/.pnpm/node_modules/@sdar \
    && touch -h -d '@0' node_modules/.pnpm/node_modules

FROM ${NODE_BASE_IMAGE} AS npc-real-base
ARG VCS_REF=unknown
ENV NODE_ENV=production
WORKDIR /app
LABEL org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="https://github.com/zhouwen-giser/sdar-mcp-provider-platform" \
      org.opencontainers.image.licenses="Apache-2.0"
COPY --from=npc-real-production-dependencies --chown=root:root /workspace/node_modules /app/node_modules
COPY --from=build --chown=root:root /workspace/dist/packages /app/dist/packages
COPY --from=build --chown=root:root /workspace/proto /app/proto
COPY --from=build --chown=root:root /workspace/migrations /app/migrations
RUN mkdir -p /var/lib/sdar \
    && chown node:node /var/lib/sdar \
    && touch -d '@0' /var/lib/sdar /app
USER node

FROM npc-real-base AS npc-real-runtime
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="SDAR NPC Tank Qualification Runtime" \
      org.opencontainers.image.revision="${VCS_REF}"
COPY --from=build --chown=root:root /workspace/dist/apps/runtime /app/dist/apps/runtime
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/apps/runtime/src/main.js"]

FROM npc-real-base AS npc-real-adapter
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="SDAR Real NPC Tank Provider Adapter" \
      org.opencontainers.image.revision="${VCS_REF}"
COPY --from=build --chown=root:root /workspace/dist/apps/npc-tank-provider-adapter /app/dist/apps/npc-tank-provider-adapter
COPY --from=build --chown=root:root /workspace/scripts/npc-tank-simulation/capture-real-contracts.mjs /app/scripts/npc-tank-simulation/capture-real-contracts.mjs
COPY --from=build --chown=root:root /workspace/scripts/ugv-simulation/lib.mjs /app/scripts/ugv-simulation/lib.mjs
EXPOSE 7013
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "try{process.kill(1,0)}catch{process.exit(1)}"]
CMD ["node", "dist/apps/npc-tank-provider-adapter/src/main.js"]

# Standalone production bundle targets intentionally derive from the real
# provider images while giving the immutable artifacts production-specific
# identities. Runtime production safety is enforced by configuration at boot.
# The standalone bundles explicitly opt into plaintext transport for an
# operator-enforced, strictly isolated internal network.
FROM ugv-real-runtime AS ugv-production-runtime
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="SDAR UGV Production Runtime" \
      org.opencontainers.image.revision="${VCS_REF}" \
      io.sdar.production-bundle.profile="production" \
      io.sdar.production-bundle.provider="ugv"
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

FROM ugv-real-adapter AS ugv-production-adapter
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="SDAR UGV Production Provider Adapter" \
      org.opencontainers.image.revision="${VCS_REF}" \
      io.sdar.production-bundle.profile="production" \
      io.sdar.production-bundle.provider="ugv"
EXPOSE 7010
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const net=require('node:net');const socket=net.connect({host:'127.0.0.1',port:Number(process.env.ADAPTER_PORT||7010)},()=>socket.end());socket.setTimeout(2000,()=>socket.destroy(Error('timeout')));socket.on('error',()=>process.exit(1))"]

FROM npc-real-runtime AS npc-tank-production-runtime
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="SDAR NPC Tank Production Runtime" \
      org.opencontainers.image.revision="${VCS_REF}" \
      io.sdar.production-bundle.profile="production" \
      io.sdar.production-bundle.provider="npc-tank"

FROM npc-real-adapter AS npc-tank-production-adapter
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="SDAR NPC Tank Production Provider Adapter" \
      org.opencontainers.image.revision="${VCS_REF}" \
      io.sdar.production-bundle.profile="production" \
      io.sdar.production-bundle.provider="npc-tank"
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const net=require('node:net');const socket=net.connect({host:'127.0.0.1',port:Number(process.env.ADAPTER_PORT||7013)},()=>socket.end());socket.setTimeout(2000,()=>socket.destroy(Error('timeout')));socket.on('error',()=>process.exit(1))"]

FROM ${NODE_BASE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /workspace/node_modules /app/node_modules
COPY --from=build /workspace/dist /app/dist
COPY --from=build /workspace/proto /app/proto
COPY --from=build /workspace/migrations /app/migrations
RUN mkdir -p /var/lib/sdar \
    && chown node:node /var/lib/sdar \
    && touch -d '@0' /var/lib/sdar /app
USER node
CMD ["node", "dist/apps/runtime/src/main.js"]

FROM ${NODE_BASE_IMAGE} AS pms-base
ARG VCS_REF=unknown
ENV NODE_ENV=production
WORKDIR /app
LABEL org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="https://github.com/zhouwen-giser/sdar-mcp-provider-platform" \
      org.opencontainers.image.licenses="Apache-2.0"
COPY --from=production-dependencies --chown=root:root /workspace/node_modules /app/node_modules
COPY --from=build --chown=root:root /workspace/dist /app/dist
COPY --from=build --chown=root:root /workspace/release-packages /app/packages
COPY --from=build --chown=root:root /workspace/migrations /app/migrations
RUN mkdir -p /var/lib/sdar /app/node_modules/@sdar \
    && for package in /app/packages/*; do \
      test -f "$package/package.json" || continue; \
      ln -s "$package" "/app/node_modules/@sdar/$(basename "$package")"; \
    done \
    && chown node:node /var/lib/sdar
USER node

FROM pms-base AS pms-api
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="SDAR Provider Management API" \
      org.opencontainers.image.revision="${VCS_REF}"
COPY --from=build --chown=root:root /workspace/provider-packages /app/provider-packages
COPY --from=build --chown=root:root /workspace/packages/pms-console-api-contract/schema /app/packages/pms-console-api-contract/schema
RUN test -f /app/provider-packages/ugv/provider-package.json \
    && test -f /app/packages/pms-console-api-contract/schema/openapi.bundle.json
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8090/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/apps/pms-api/src/main.js"]

FROM pms-api AS pms-api-ugv-production
USER root
RUN find /app/provider-packages -mindepth 1 -maxdepth 1 ! -name ugv -exec rm -rf -- {} + \
    && find /app/dist/apps -mindepth 1 -maxdepth 1 ! -name pms-api -exec rm -rf -- {} + \
    && test -f /app/provider-packages/ugv/provider-package.json
USER node
LABEL io.sdar.production-bundle.profile="production" \
      io.sdar.production-bundle.provider="ugv"

FROM pms-api AS pms-api-npc-tank-production
USER root
RUN find /app/provider-packages -mindepth 1 -maxdepth 1 ! -name npc-tank -exec rm -rf -- {} + \
    && find /app/dist/apps -mindepth 1 -maxdepth 1 ! -name pms-api -exec rm -rf -- {} + \
    && test -f /app/provider-packages/npc-tank/provider-package.json
USER node
LABEL io.sdar.production-bundle.profile="production" \
      io.sdar.production-bundle.provider="npc-tank"

FROM pms-base AS pms-worker
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="SDAR Provider Management Worker" \
      org.opencontainers.image.revision="${VCS_REF}"
COPY --from=build --chown=root:root /workspace/provider-packages /app/provider-packages
COPY --from=build --chown=root:root /workspace/proto /app/proto
USER root
RUN runtime_release=/app/runtime-releases/2.0.0-rc.1 \
    && mkdir -p "$runtime_release" \
      /var/lib/sdar/runtime-secrets \
      /var/lib/sdar/runtime-cache \
      /var/lib/sdar/runtime-control-plane \
      /var/lib/sdar/pm2 \
    && cp -a /app/dist /app/proto /app/migrations "$runtime_release/" \
    && node --input-type=module -e 'import { writeFileSync } from "node:fs"; writeFileSync("/app/runtime-releases/runtime-releases.json", `${JSON.stringify({ schemaVersion: 1, releases: [{ version: "2.0.0-rc.1", directory: "2.0.0-rc.1" }] })}\n`)' \
    && chown -R root:root /app/runtime-releases \
    && find /app/runtime-releases -type d -exec chmod 0555 {} + \
    && find /app/runtime-releases -type f -exec chmod 0444 {} + \
    && chmod 0555 "$runtime_release/dist/apps/runtime/src/main.js" \
    && chown -R node:node /var/lib/sdar \
    && find /var/lib/sdar -mindepth 1 -maxdepth 1 -type d -exec chmod 0700 {} + \
    && find /app/runtime-releases /var/lib/sdar -exec touch -h -d '@0' {} + \
    && test -f /app/migrations/migration-source-map.json \
    && test -d /app/migrations/pms \
    && test -d /app/migrations/runtime \
    && test -f /app/provider-packages/ugv/provider-package.json \
    && test -x "$runtime_release/dist/apps/runtime/src/main.js" \
    && test -f /app/runtime-releases/runtime-releases.json
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "try{process.kill(1,0)}catch{process.exit(1)}"]
CMD ["node", "dist/apps/pms-worker/src/main.js"]

FROM pms-worker AS pms-worker-ugv-production
USER root
RUN find /app/provider-packages -mindepth 1 -maxdepth 1 ! -name ugv -exec rm -rf -- {} + \
    && find /app/dist/apps -mindepth 1 -maxdepth 1 ! -name pms-worker -exec rm -rf -- {} + \
    && find /app/runtime-releases/2.0.0-rc.1/dist/apps -mindepth 1 -maxdepth 1 ! -name runtime -exec rm -rf -- {} + \
    && test -f /app/provider-packages/ugv/provider-package.json \
    && test -f /app/runtime-releases/2.0.0-rc.1/dist/apps/runtime/src/main.js
USER node
LABEL io.sdar.production-bundle.profile="production" \
      io.sdar.production-bundle.provider="ugv"

FROM pms-worker AS pms-worker-npc-tank-production
USER root
RUN find /app/provider-packages -mindepth 1 -maxdepth 1 ! -name npc-tank -exec rm -rf -- {} + \
    && find /app/dist/apps -mindepth 1 -maxdepth 1 ! -name pms-worker -exec rm -rf -- {} + \
    && find /app/runtime-releases/2.0.0-rc.1/dist/apps -mindepth 1 -maxdepth 1 ! -name runtime -exec rm -rf -- {} + \
    && test -f /app/provider-packages/npc-tank/provider-package.json \
    && test -f /app/runtime-releases/2.0.0-rc.1/dist/apps/runtime/src/main.js
USER node
LABEL io.sdar.production-bundle.profile="production" \
      io.sdar.production-bundle.provider="npc-tank"

FROM ${NODE_BASE_IMAGE} AS pms-web
ARG VCS_REF=unknown
ENV NODE_ENV=production \
    PMS_WEB_ROOT=/app/web \
    PMS_WEB_HOST=0.0.0.0 \
    PMS_WEB_PORT=8080
WORKDIR /app
LABEL org.opencontainers.image.title="SDAR Provider Management Web" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="https://github.com/zhouwen-giser/sdar-mcp-provider-platform" \
      org.opencontainers.image.licenses="Apache-2.0"
COPY --from=build --chown=root:root /workspace/apps/pms-web/dist /app/web
COPY --chown=root:root scripts/serve-pms-web.mjs /app/server.mjs
RUN test -f /app/web/index.html \
    && test -f /app/server.mjs \
    && find /app/web/assets -type f -name '*.css' -print -quit | grep -q . \
    && find /app/web/assets -type f -name '*.js' -print -quit | grep -q .
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.mjs"]

FROM pms-web AS pms-web-production
ARG VCS_REF=unknown
LABEL org.opencontainers.image.revision="${VCS_REF}" \
      io.sdar.production-bundle.profile="production" \
      io.sdar.production-bundle.provider="shared"

FROM runtime AS adapter-ts
CMD ["node", "dist/examples/mock-adapter-typescript/src/main.js"]

FROM runtime AS home-assistant-climate-provider
CMD ["node", "dist/apps/home-assistant-climate-provider/src/main.js"]

FROM runtime AS home-assistant-light-provider
CMD ["node", "dist/apps/home-assistant-light-provider/src/main.js"]

FROM runtime AS ugv-provider-adapter
CMD ["node", "dist/apps/ugv-provider-adapter/src/main.js"]

FROM runtime AS npc-tank-provider-adapter
CMD ["node", "dist/apps/npc-tank-provider-adapter/src/main.js"]

FROM runtime AS mock-ugv-device-mcp
CMD ["node", "dist/apps/mock-ugv-device-mcp/src/main.js"]

FROM runtime AS mock-ugv-mqtt-publisher
CMD ["node", "dist/apps/mock-ugv-mqtt-publisher/src/main.js"]

FROM runtime AS mock-npc-tank-device-mcp
CMD ["node", "dist/apps/mock-npc-tank-device-mcp/src/main.js"]

FROM runtime AS mock-npc-tank-mqtt-publisher
CMD ["node", "dist/apps/mock-npc-tank-mqtt-publisher/src/main.js"]
