ARG NODE_BASE_IMAGE=node:22-bookworm-slim
FROM ${NODE_BASE_IMAGE} AS build
WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV npm_config_store_dir=/pnpm/store
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/ugv-control-console/package.json apps/ugv-control-console/package.json
RUN --mount=type=cache,id=sdar-corepack,target=/root/.cache/node/corepack,sharing=locked \
    --mount=type=cache,id=sdar-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --filter @sdar/ugv-control-console --frozen-lockfile --ignore-scripts --prefer-offline --store-dir=/pnpm/store
COPY apps/ugv-control-console apps/ugv-control-console
RUN --mount=type=cache,id=sdar-corepack,target=/root/.cache/node/corepack,sharing=locked \
    --mount=type=cache,id=sdar-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm --filter @sdar/ugv-control-console build \
    && pnpm --filter @sdar/ugv-control-console deploy --legacy --prod /release
FROM ${NODE_BASE_IMAGE} AS runtime
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="SMPP UGV Control Console" org.opencontainers.image.revision=$VCS_REF
ENV NODE_ENV=production
ENV UGV_CONSOLE_PROTOCOL=http
WORKDIR /app
COPY --from=build --chown=node:node /release/ ./
USER node
EXPOSE 19101
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD ["node","--input-type=module","-e","const secure=process.env.UGV_CONSOLE_PROTOCOL==='https';const {get}=await import(secure?'node:https':'node:http');const r=get(`${secure?'https':'http'}://127.0.0.1:${process.env.UGV_CONSOLE_PORT??19101}/health/ready`,secure?{rejectUnauthorized:false}:{},s=>{s.resume();process.exitCode=s.statusCode===200?0:1});r.on('error',()=>process.exit(1));r.setTimeout(4000,()=>{r.destroy();process.exitCode=1})"]
CMD ["node","build/server/main.js"]
