import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  RegistrySnapshot,
  RegistrySnapshotRepository,
} from "../../../packages/registry-snapshot/src/index.js";
import {
  SDAR_REGISTRY_PROJECTION_CONTRACT,
  SDAR_REGISTRY_PROJECTION_TTL_SECONDS_DEFAULT,
  SdarRegistryProjectionError,
  projectSdarRegistrySnapshot,
  validateSdarRegistryProjectionTtlSeconds,
  type SdarRegistryProjection,
} from "./sdar-registry-projection.js";

interface ProjectionParameters {
  readonly environment: string;
  readonly smppSourceId: string;
}

export interface SdarRegistryProjectionRouteOptions {
  readonly ttlSeconds?: number;
  readonly pollIntervalMs?: number;
}

export function registerSdarRegistryProjectionRoutes(
  app: FastifyInstance,
  repository: RegistrySnapshotRepository,
  options: SdarRegistryProjectionRouteOptions = {},
): void {
  const ttlSeconds = options.ttlSeconds ?? SDAR_REGISTRY_PROJECTION_TTL_SECONDS_DEFAULT;
  validateSdarRegistryProjectionTtlSeconds(ttlSeconds);
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 60_000) {
    throw new RangeError("SDAR_REGISTRY_PROJECTION_WATCH_POLL_INTERVAL_INVALID");
  }
  const base = "/api/v1/registry/:environment/consumers/sdar/v1/sources/:smppSourceId";
  const schema = { schema: { params: projectionParametersSchema() } } as const;

  app.get<{ Params: ProjectionParameters }>(`${base}/latest`, schema, async (request, reply) => {
    const native = await requireLatest(repository, request.params.environment);
    const projection = projectSdarRegistrySnapshot(native, request.params.smppSourceId, ttlSeconds);
    return sendProjection(request.headers["if-none-match"], native, projection, reply);
  });

  app.get<{ Params: ProjectionParameters }>(`${base}/bootstrap`, schema, async (request, reply) => {
    const native = await requireLatest(repository, request.params.environment);
    const projection = projectSdarRegistrySnapshot(native, request.params.smppSourceId, ttlSeconds);
    return sendProjection(request.headers["if-none-match"], native, projection, reply);
  });

  app.get<{ Params: ProjectionParameters }>(`${base}/watch`, schema, async (request, reply) => {
    const initialNative = await repository.latest(request.params.environment);
    const initialProjection =
      initialNative === null
        ? null
        : projectSdarRegistrySnapshot(initialNative, request.params.smppSourceId, ttlSeconds);
    reply.hijack();
    reply.raw.writeHead(200, watchHeaders(initialNative, initialProjection));
    let checksum = initialProjection?.checksum;
    if (initialNative !== null && initialProjection !== null) {
      reply.raw.write(
        `retry: 3000\n${sseHint(
          initialNative.environment,
          request.params.smppSourceId,
          initialProjection,
        )}\n`,
      );
    }
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void repository
        .latest(request.params.environment)
        .then((native) => {
          if (reply.raw.destroyed || native === null) return;
          const projection = projectSdarRegistrySnapshot(
            native,
            request.params.smppSourceId,
            ttlSeconds,
          );
          if (projection.checksum === checksum) return;
          checksum = projection.checksum;
          reply.raw.write(
            `${sseHint(native.environment, request.params.smppSourceId, projection)}\n`,
          );
        })
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    }, pollIntervalMs);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      reply.raw.off("close", close);
      reply.raw.off("error", close);
    };
    reply.raw.once("close", close);
    reply.raw.once("error", close);
    return reply;
  });
}

async function requireLatest(
  repository: RegistrySnapshotRepository,
  environment: string,
): Promise<RegistrySnapshot> {
  const native = await repository.latest(environment);
  if (native === null) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_NOT_FOUND");
  }
  return native;
}

function sendProjection(
  ifNoneMatch: string | readonly string[] | undefined,
  native: RegistrySnapshot,
  projection: SdarRegistryProjection,
  reply: FastifyReply,
) {
  const etag = `"${projection.checksum}"`;
  void reply
    .header("etag", etag)
    .header("cache-control", "private, no-cache")
    .header("x-smpp-native-revision", String(native.revision))
    .header("x-smpp-native-checksum", native.checksum)
    .header("x-smpp-projection-contract", SDAR_REGISTRY_PROJECTION_CONTRACT);
  if (etagMatches(ifNoneMatch, projection.checksum)) return reply.status(304).send();
  return reply.send(projection);
}

function watchHeaders(
  native: RegistrySnapshot | null,
  projection: SdarRegistryProjection | null,
): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-smpp-projection-contract": SDAR_REGISTRY_PROJECTION_CONTRACT,
    ...(native === null || projection === null
      ? {}
      : {
          etag: `"${projection.checksum}"`,
          "x-smpp-native-revision": String(native.revision),
          "x-smpp-native-checksum": native.checksum,
        }),
  };
}

function sseHint(
  environment: string,
  smppSourceId: string,
  projection: SdarRegistryProjection,
): string {
  return `id: ${projection.checksum}\nevent: revision\ndata: ${JSON.stringify({
    environment,
    smppSourceId,
    revision: projection.revision,
    checksum: projection.checksum,
  })}\n`;
}

function etagMatches(value: string | readonly string[] | undefined, checksum: string): boolean {
  if (typeof value !== "string") return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "");
    return normalized === "*" || normalized === `"${checksum}"` || normalized === checksum;
  });
}

function projectionParametersSchema() {
  return {
    type: "object",
    required: ["environment", "smppSourceId"],
    properties: {
      environment: { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" },
      smppSourceId: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      },
    },
    additionalProperties: false,
  } as const;
}
