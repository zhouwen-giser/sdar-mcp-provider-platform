# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/home-assistant-climate-provider/package.json apps/home-assistant-climate-provider/package.json
COPY apps/runtime/package.json apps/runtime/package.json
COPY packages packages
COPY apps/home-assistant-climate-provider apps/home-assistant-climate-provider
COPY proto proto
COPY tsconfig.json tsconfig.build.json ./
RUN pnpm install --frozen-lockfile && pnpm build && CI=true pnpm prune --prod

FROM node:22-bookworm-slim AS home-assistant-climate-provider
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /workspace/node_modules /app/node_modules
COPY --from=build /workspace/dist /app/dist
COPY --from=build /workspace/proto /app/proto
RUN mkdir -p /var/lib/sdar && chown node:node /var/lib/sdar
USER node
CMD ["node", "dist/apps/home-assistant-climate-provider/src/main.js"]
