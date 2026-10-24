import Fastify from "fastify";
import { z } from "zod";
import {
  VehicleObservationStateV2,
  VehicleObservationCapabilitiesV2,
  decimal,
  type ZmqObservationObserver,
  type PostgresObservationArchive,
} from "../../../packages/vehicle-zmq-observer/src/index.js";

export function buildObservationApi(
  observer: ZmqObservationObserver,
  archive: Pick<PostgresObservationArchive, "sessions" | "page" | "raw" | "storage">,
) {
  const app = Fastify({ logger: false, bodyLimit: 1024, requestTimeout: 5000 });
  app.get("/health", (_request, reply) => {
    const snapshot = observer.snapshot();
    return reply.code(snapshot.archive.status === "failed" ? 503 : 200).send({
      readOnly: true,
      status: snapshot.archive.status,
      archive: snapshot.archive,
      channels: snapshot.channels,
      runtimeAdmission: snapshot.runtimeAdmission,
    });
  });
  app.get("/v2/state", () => observer.snapshot());
  app.get("/v2/capabilities", () => observer.state.capabilities());
  app.get("/v2/storage", () => archive.storage());
  app.get("/v2/schemas", () => ({
    state: z.toJSONSchema(VehicleObservationStateV2),
    capabilities: z.toJSONSchema(VehicleObservationCapabilitiesV2),
  }));
  app.get("/v2/sessions", async (request) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
      .strict()
      .parse(request.query);
    return {
      partitionHash: observer.scope.partitionHash,
      sessions: await archive.sessions(query.limit),
    };
  });
  app.get("/v2/receptions", async (request) => {
    const query = z
      .object({
        sessionId: z.uuid(),
        after: decimal.default("0"),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .strict()
      .parse(request.query);
    return archive.page(query.sessionId, query.after, query.limit);
  });
  app.get("/v2/receptions/:sessionId/:ordinal/raw", async (request) => {
    const params = z
      .object({ sessionId: z.uuid(), ordinal: decimal })
      .strict()
      .parse(request.params);
    return archive.raw(params.sessionId, params.ordinal);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({ error: "ZMQ_READ_QUERY_INVALID" });
    const code =
      error instanceof Error && /^ZMQ_[A-Z0-9_]{1,120}$/.test(error.message)
        ? error.message
        : "ZMQ_READ_FAILED";
    return reply.code(code.endsWith("_NOT_FOUND") ? 404 : 500).send({ error: code });
  });
  app.setNotFoundHandler((request, reply) =>
    reply
      .code(request.method === "GET" ? 404 : 405)
      .header("Allow", "GET, HEAD")
      .send({
        error: request.method === "GET" ? "ZMQ_READ_ROUTE_NOT_FOUND" : "ZMQ_OBSERVER_READ_ONLY",
      }),
  );
  return app;
}
