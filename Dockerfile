# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml .npmrc ./
COPY apps/runtime/package.json apps/runtime/package.json
COPY apps/home-assistant-climate-provider/package.json apps/home-assistant-climate-provider/package.json
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
COPY Dockerfile Dockerfile
COPY scripts/verify-docker-workspace-manifests.mjs scripts/verify-docker-workspace-manifests.mjs
RUN node scripts/verify-docker-workspace-manifests.mjs
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM build AS production-dependencies
RUN CI=true pnpm prune --prod \
    && find node_modules -type f -name '*.map' -delete \
    && find node_modules -type f -iname '*.md' \
      ! -iname 'license*' ! -iname 'notice*' ! -iname 'copying*' -delete

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /workspace/node_modules /app/node_modules
COPY --from=build /workspace/dist /app/dist
COPY --from=build /workspace/proto /app/proto
COPY --from=build /workspace/migrations /app/migrations
RUN mkdir -p /var/lib/sdar && chown node:node /var/lib/sdar
USER node
CMD ["node", "dist/apps/runtime/src/main.js"]

FROM runtime AS adapter-ts
CMD ["node", "dist/examples/mock-adapter-typescript/src/main.js"]

FROM runtime AS home-assistant-climate-provider
CMD ["node", "dist/apps/home-assistant-climate-provider/src/main.js"]

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
