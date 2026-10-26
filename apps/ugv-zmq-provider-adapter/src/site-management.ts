import Fastify from "fastify";
import { z } from "zod";
import { createAuthorizationResolver } from "../../../packages/mcp-protocol/src/security.js";
import type { ZmqControlEngine } from "../../../packages/vehicle-zmq-control/src/engine.js";
export async function openSiteManagement(engine: ZmqControlEngine, secret: string, port: number) {
  if (secret.length < 32) throw Error("ZMQ_MANAGEMENT_JWT_SECRET_REQUIRED");
  const authorize = createAuthorizationResolver({ mode: "jwt_hs256", secret });
  const app = Fastify({ logger: false, bodyLimit: 8192 });
  app.setErrorHandler((error, _req, reply) => {
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "ZMQ_RECONCILIATION_INVALID";
    void reply.code(409).send({ reasonCode: code });
  });
  app.post("/reconcile", async (request) => {
    const auth = authorize(request.raw);
    if (auth.executionMode !== "live" || auth.verifiedResponder?.actorType !== "operator")
      throw Error("ZMQ_OPERATOR_IDENTITY_REQUIRED");
    const input = z
      .object({
        commandId: z.uuid(),
        component: z.enum(["chassis", "eo", "simulationEffect"]),
        taskId: z.string().min(1),
        reason: z.string().trim().min(1).max(1024),
      })
      .strict()
      .parse(request.body);
    const e = await engine.reconcileComponent(input, {
      authorizationContextHash: auth.hash,
      executionMode: "live",
      simulationId: "",
      correlationId: auth.correlationId ?? input.commandId,
    });
    return {
      commandId: input.commandId,
      taskId: e.taskId,
      component: input.component,
      occupancy: e.zmqControl.occupancy,
      originalResult: e.result,
      reconciliation: (e.zmqControl as unknown as Record<string, unknown>).reconciliation,
    };
  });
  await app.listen({ host: "127.0.0.1", port });
  return app;
}
