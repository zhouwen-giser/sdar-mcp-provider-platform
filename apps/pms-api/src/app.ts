import Fastify, { type FastifyInstance } from "fastify";
import { attachRequestContext, requestContext } from "./context.js";
import { notFoundError, sendPmsError } from "./errors.js";
import { pmsOpenApiDocument } from "./openapi.js";

export interface PmsReadiness {
  readonly ready: boolean;
  readonly checks?: Readonly<Record<string, "ready" | "unavailable">>;
}

export interface PmsApiOptions {
  readonly readiness?: () => Promise<PmsReadiness>;
}

export function createPmsApi(options: PmsApiOptions = {}): FastifyInstance {
  const readiness: () => Promise<PmsReadiness> =
    options.readiness ?? (() => Promise.resolve({ ready: true }));
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });

  app.addHook("onRequest", (request, reply, done) => {
    attachRequestContext(request, reply);
    done();
  });
  app.setErrorHandler(sendPmsError);
  app.setNotFoundHandler(notFoundError);

  app.get("/health/live", () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    const state = await readiness();
    if (!state.ready) void reply.status(503);
    return { status: state.ready ? "ready" : "unavailable", checks: state.checks ?? {} };
  });
  app.get("/api/v1", (request) => ({
    apiVersion: "v1",
    request: requestContext(request),
    links: { openapi: "/api/v1/openapi.json" },
  }));
  app.get("/api/v1/openapi.json", () => pmsOpenApiDocument());

  return app;
}
