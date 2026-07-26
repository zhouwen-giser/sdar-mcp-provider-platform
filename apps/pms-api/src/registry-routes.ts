import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  RegistrySnapshot,
  RegistrySnapshotRepository,
} from "../../../packages/registry-snapshot/src/index.js";

interface EnvironmentParameters {
  readonly environment: string;
}

interface HistoryQuery {
  readonly limit?: number;
}

interface DiffQuery {
  readonly fromRevision: number;
  readonly toRevision: number;
}

export interface RegistryRouteOptions {
  readonly pollIntervalMs?: number;
}

export function registerRegistryRoutes(
  app: FastifyInstance,
  repository: RegistrySnapshotRepository,
  options: RegistryRouteOptions = {},
): void {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 60_000) {
    throw new RangeError("REGISTRY_WATCH_POLL_INTERVAL_INVALID");
  }

  app.get<{ Params: EnvironmentParameters }>(
    "/api/v1/registry/:environment/latest",
    { schema: { params: environmentSchema() } },
    async (request, reply) => {
      const latest = await repository.latest(request.params.environment);
      if (latest === null) {
        return reply.status(404).send({ error: { code: "REGISTRY_SNAPSHOT_NOT_FOUND" } });
      }
      return sendSnapshot(request.headers["if-none-match"], latest, reply);
    },
  );

  app.get<{ Params: EnvironmentParameters; Querystring: HistoryQuery }>(
    "/api/v1/registry/:environment/history",
    {
      schema: {
        params: environmentSchema(),
        querystring: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
          additionalProperties: false,
        },
      },
    },
    async (request) => ({
      items: await repository.history(request.params.environment, request.query.limit),
    }),
  );

  app.get<{ Params: EnvironmentParameters; Querystring: DiffQuery }>(
    "/api/v1/registry/:environment/diff",
    {
      schema: {
        params: environmentSchema(),
        querystring: {
          type: "object",
          required: ["fromRevision", "toRevision"],
          properties: {
            fromRevision: { type: "integer", minimum: 1 },
            toRevision: { type: "integer", minimum: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    (request) =>
      repository.diff(
        request.params.environment,
        request.query.fromRevision,
        request.query.toRevision,
      ),
  );

  app.get<{ Params: EnvironmentParameters }>(
    "/api/v1/registry/:environment/bootstrap",
    { schema: { params: environmentSchema() } },
    async (request, reply) => {
      const latest = await repository.latest(request.params.environment);
      const snapshot = latest ?? emptyBootstrapSnapshot(request.params.environment);
      void reply
        .header("etag", `"${snapshot.checksum}"`)
        .header("cache-control", "private, no-cache");
      return {
        source: latest === null ? "empty_safe_default" : "registry_lkg",
        snapshot,
      };
    },
  );

  app.get<{ Params: EnvironmentParameters }>(
    "/api/v1/registry/:environment/watch",
    { schema: { params: environmentSchema() } },
    async (request, reply) => {
      const initial = await repository.latest(request.params.environment);
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      let checksum = initial?.checksum;
      if (initial !== null) reply.raw.write(`retry: 3000\n${sseHint(initial)}\n`);
      let polling = false;
      const timer = setInterval(() => {
        if (polling) return;
        polling = true;
        void repository
          .latest(request.params.environment)
          .then((latest) => {
            if (reply.raw.destroyed || latest === null || latest.checksum === checksum) {
              return;
            }
            checksum = latest.checksum;
            reply.raw.write(`${sseHint(latest)}\n`);
          })
          .catch(() => undefined)
          .finally(() => {
            polling = false;
          });
      }, pollIntervalMs);
      const close = () => clearInterval(timer);
      reply.raw.once("close", close);
      reply.raw.once("error", close);
      return reply;
    },
  );
}

function sendSnapshot(
  ifNoneMatch: string | readonly string[] | undefined,
  snapshot: RegistrySnapshot,
  reply: FastifyReply,
) {
  const etag = `"${snapshot.checksum}"`;
  void reply.header("etag", etag).header("cache-control", "private, no-cache");
  if (etagMatches(ifNoneMatch, snapshot.checksum)) return reply.status(304).send();
  return reply.send(snapshot);
}

function emptyBootstrapSnapshot(environment: string): RegistrySnapshot {
  const document = { environment, providers: [] };
  const checksum = createHash("sha256").update(JSON.stringify(document)).digest("hex");
  const epoch = new Date(0);
  return {
    environment,
    revision: 0,
    checksum,
    document,
    publishedAt: epoch,
    createdAt: epoch,
  };
}

function sseHint(snapshot: RegistrySnapshot): string {
  return `id: ${snapshot.checksum}\nevent: revision\ndata: ${JSON.stringify({
    environment: snapshot.environment,
    revision: snapshot.revision,
    checksum: snapshot.checksum,
  })}\n`;
}

function etagMatches(value: string | readonly string[] | undefined, checksum: string): boolean {
  if (typeof value !== "string") return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "");
    return normalized === "*" || normalized === `"${checksum}"` || normalized === checksum;
  });
}

function environmentSchema() {
  return {
    type: "object",
    required: ["environment"],
    properties: {
      environment: { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" },
    },
    additionalProperties: false,
  } as const;
}
