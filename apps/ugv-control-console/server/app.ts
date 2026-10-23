import Fastify from "fastify";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { z } from "zod";
import type { Config } from "./config.js";
import { passwordMatches, session, sessionToken, verifySession } from "./security.js";
import type { Service } from "./service.js";
import { safeCode } from "./service.js";
import { CommandSchema, array, record, text, type Json } from "../shared/model.js";
const taskParams = z.object({ taskId: z.string().min(1).max(256) });
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
function containsTask(value: unknown, taskId: string, depth = 0): boolean {
  if (depth > 10) return false;
  if (Array.isArray(value)) return value.some((v) => containsTask(v, taskId, depth + 1));
  const obj = record(value);
  return (
    obj.taskId === taskId ||
    array(obj.taskIds).includes(taskId) ||
    Object.values(obj).some(
      (v) => v !== null && typeof v === "object" && containsTask(v, taskId, depth + 1),
    )
  );
}
export function createApp(config: Config, service: Service) {
  const cookieName = config.secure ? "ugv_session" : "ugv_session_http";
  const app = Fastify({
    ...(config.tls ? { https: config.tls } : {}),
    bodyLimit: 1048576,
    logger: false,
    trustProxy: false,
  });
  const failures = new Map<string, { count: number; until: number }>();
  let streams = 0;
  const streamControllers = new Set<AbortController>();
  app.addHook("preClose", () =>
    Promise.resolve().then(() => {
      for (const controller of streamControllers) controller.abort();
    }),
  );
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "same-origin")
      .header("x-frame-options", "DENY")
      .header(
        "content-security-policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    if (request.url.startsWith("/health/")) return;
    if (!config.origins.some((origin) => new URL(origin).host === request.headers.host))
      return reply.code(403).send({ reasonCode: "HOST_NOT_ALLOWED" });
    if (request.method !== "GET" && request.method !== "HEAD") {
      if (!request.headers.origin || !config.origins.includes(request.headers.origin))
        return reply.code(403).send({ reasonCode: "ORIGIN_NOT_ALLOWED" });
      if (request.headers["sec-fetch-site"] === "cross-site")
        return reply.code(403).send({ reasonCode: "ORIGIN_NOT_ALLOWED" });
    }
    if (
      request.url.startsWith("/api/") &&
      request.url.split("?")[0] !== "/api/session/login" &&
      (!verifySession(config.credentials, request.headers.cookie, Date.now(), cookieName) ||
        !(await service.store.sessionAllowed(sessionToken(request.headers.cookie, cookieName))))
    )
      return reply.code(401).send({ reasonCode: "LOGIN_REQUIRED" });
  });
  app.setErrorHandler((error, request, reply) => {
    const code = error instanceof z.ZodError ? "REQUEST_INVALID" : safeCode(error);
    const status =
      code === "COMMAND_ID_CONFLICT"
        ? 409
        : code.includes("NOT_IMPORTED")
          ? 404
          : error instanceof z.ZodError
            ? 400
            : 409;
    if (!reply.sent) reply.code(status).send({ reasonCode: code, requestId: request.id });
  });
  app.get("/health/live", () => Promise.resolve({ status: "ok" }));
  app.get("/health/ready", async () => {
    await service.store.pool.query("SELECT 1");
    return { status: "ok" };
  });
  app.post("/api/session/login", async (request, reply) => {
    const { username, password } = z
      .object({ username: z.string().max(128), password: z.string().max(1024) })
      .strict()
      .parse(request.body);
    const now = Date.now(),
      entry = failures.get(request.ip);
    if (entry && entry.until > now && entry.count >= 5)
      return reply.code(429).send({ reasonCode: "LOGIN_RATE_LIMITED" });
    if (!passwordMatches(config.credentials, username, password)) {
      if (failures.size >= 1000) {
        for (const [key, value] of failures) if (value.until <= now) failures.delete(key);
        if (failures.size >= 1000)
          return reply.code(429).send({ reasonCode: "LOGIN_RATE_LIMITED" });
      }
      failures.set(request.ip, {
        count: entry && entry.until > now ? entry.count + 1 : 1,
        until: entry && entry.until > now ? entry.until : now + 900000,
      });
      await service.store.audit("unauthenticated", "login.rejected");
      return reply.code(401).send({ reasonCode: "LOGIN_FAILED" });
    }
    failures.delete(request.ip);
    await service.store.audit(config.credentials.username, "login.accepted");
    const token = session(config.credentials);
    await service.store.createSession(token);
    reply.header(
      "set-cookie",
      `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${config.secure ? "; Secure" : ""}`,
    );
    return { username: config.credentials.username };
  });
  app.get("/api/session", () =>
    Promise.resolve({
      username: config.credentials.username,
      executionMode: config.upstreamHeaders["x-sdar-execution-mode"],
    }),
  );
  app.post("/api/session/logout", async (request, reply) => {
    await service.store.revokeSession(sessionToken(request.headers.cookie, cookieName));
    reply.header(
      "set-cookie",
      `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.secure ? "; Secure" : ""}`,
    );
    return { ok: true };
  });
  app.get("/api/device", async () => service.state());
  app.post("/api/read", async (request) => {
    const input = z
      .object({ tool: z.string().max(128), arguments: z.record(z.string(), z.unknown()) })
      .strict()
      .parse(request.body);
    return service.readTool(input.tool, input.arguments);
  });
  app.post("/api/availability", async (request) => {
    const input = CommandSchema.pick({ tool: true, arguments: true, timing: true }).parse(
      request.body,
    );
    return service.availability(input.tool ?? "", input.arguments, input.timing);
  });
  app.get("/api/commands", async () => service.store.commands());
  app.get("/api/commands/:commandId", async (request, reply) => {
    const { commandId } = z.object({ commandId: z.uuid() }).parse(request.params);
    const command = await service.store.command(commandId);
    return command ?? reply.code(404).send({ reasonCode: "COMMAND_NOT_FOUND" });
  });
  app.post("/api/commands", async (request, reply) => {
    const command = await service.execute(CommandSchema.parse(request.body));
    return reply.code(command?.status === "rejected" ? 409 : 202).send(command);
  });
  app.get("/api/tasks", async () => service.store.tasks());
  app.post("/api/tasks/import", async (request) => {
    const { taskId } = taskParams.strict().parse(request.body);
    return service.importTask(taskId);
  });
  app.get("/api/tasks/:taskId", async (request) =>
    service.task(taskParams.parse(request.params).taskId),
  );
  app.get("/api/tasks/:taskId/business", async (request) =>
    service.business(taskParams.parse(request.params).taskId),
  );
  app.get("/api/tasks/:taskId/artifacts/:artifactId", async (request) => {
    const { taskId, artifactId } = taskParams
      .extend({ artifactId: z.string().min(1).max(256) })
      .parse(request.params);
    const { revision } = z
      .object({ revision: z.coerce.number().int().positive() })
      .strict()
      .parse(request.query);
    return service.artifact(taskId, artifactId, revision);
  });
  app.get("/api/tasks/:taskId/observations", async (request) => {
    const { taskId } = taskParams.parse(request.params);
    if (!(await service.store.task(taskId))) throw Error("TASK_NOT_IMPORTED");
    const query = z
      .object({
        cursor: z
          .string()
          .regex(/^[1-9][0-9]*$/)
          .optional(),
      })
      .strict()
      .parse(request.query);
    return service.mcp.rpc("io.sdar/taskExecution/tasks/observations", {
      taskId,
      limit: 100,
      ...query,
    });
  });
  app.get("/api/tasks/:taskId/report", async (request, reply) => {
    const { taskId } = taskParams.parse(request.params);
    const task = await service.task(taskId);
    let business: unknown, reasonCode: string | undefined;
    const artifacts: unknown[] = [];
    try {
      const snapshot = await service.business(taskId);
      business = snapshot;
      for (const object of snapshot.objects) {
        if (object.kind !== "artifact") continue;
        const value = record(object.value);
        try {
          artifacts.push(
            await service.artifact(taskId, text(value.artifactId), Number(value.revision)),
          );
        } catch (e) {
          artifacts.push({
            artifactId: value.artifactId,
            revision: value.revision,
            reasonCode: safeCode(e),
          });
        }
      }
    } catch (e) {
      reasonCode = safeCode(e);
    }
    reply.header(
      "content-disposition",
      `attachment; filename="ugv-report-${taskId.replace(/[^a-zA-Z0-9-]/g, "_")}.json"`,
    );
    return {
      schemaVersion: "smpp.ugv-console-report/1",
      exportedAt: new Date().toISOString(),
      task,
      business,
      artifacts,
      ...(reasonCode ? { reasonCode } : {}),
      note: "任务状态、业务完整性与证据分别保留；导出成功不代表任务成功。",
    };
  });
  app.get("/api/tasks/:taskId/events", async (request, reply) => {
    const { taskId } = taskParams.parse(request.params);
    if (!(await service.store.task(taskId))) throw Error("TASK_NOT_IMPORTED");
    if (streams >= 16) return reply.code(429).send({ reasonCode: "EVENT_STREAM_LIMIT" });
    const query = z
      .object({ cursor: z.string().max(8192).optional() })
      .strict()
      .parse(request.query);
    let cursor: Json | undefined;
    if (query.cursor)
      cursor = z
        .object({ streamId: z.string().min(1).max(256), afterSequence: z.string().regex(/^\d+$/) })
        .strict()
        .parse(JSON.parse(query.cursor));
    const controller = new AbortController();
    streams++;
    streamControllers.add(controller);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    });
    const emit = (value: Json) => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        if (reply.raw.writableLength > 1048576) {
          controller.abort();
          return;
        }
        reply.raw.write(`data: ${JSON.stringify(value)}\n\n`);
      }
    };
    const heartbeat = setInterval(() => {
      if (!verifySession(config.credentials, request.headers.cookie, Date.now(), cookieName)) {
        controller.abort();
        return;
      }
      if (!reply.raw.destroyed) reply.raw.write(": heartbeat\n\n");
    }, 15000);
    const lifetime = setTimeout(() => controller.abort(), Math.min(600000, 28800000));
    reply.raw.once("close", () => controller.abort());
    emit({ type: "connected" });
    const listeners = [
      service.mcp.listen(
        "subscriptions/listen",
        { notifications: { taskIds: [taskId] } },
        (value) => {
          if (value.error) throw Error("MCP_EVENT_STREAM_RESET");
          if (containsTask(value, taskId)) emit({ type: "task_changed" });
        },
        controller.signal,
      ),
    ];
    if (cursor)
      listeners.push(
        service.mcp.listen(
          "io.sdar/businessEvents/listen",
          { cursor },
          (value) => {
            if (value.error) throw Error("MCP_EVENT_STREAM_RESET");
            if (containsTask(value, taskId)) emit({ type: "business_changed" });
          },
          controller.signal,
        ),
      );
    void Promise.race(listeners)
      .then(() => {
        emit({ type: "resync" });
        controller.abort();
      })
      .catch(() => {
        emit({ type: "resync" });
        controller.abort();
      })
      .finally(async () => {
        controller.abort();
        await Promise.allSettled(listeners);
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        streams--;
        streamControllers.delete(controller);
        reply.raw.end();
      });
  });
  app.get("/*", async (request, reply) => {
    if (request.url.startsWith("/api/"))
      return reply.code(404).send({ reasonCode: "ROUTE_NOT_FOUND" });
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://console.invalid").pathname);
    } catch {
      return reply.code(400).send();
    }
    let file = resolve(config.webRoot, `.${pathname}`);
    if (file !== config.webRoot && !file.startsWith(config.webRoot + sep))
      return reply.code(404).send();
    try {
      if (!(await stat(file)).isFile()) file = resolve(config.webRoot, "index.html");
    } catch {
      if (extname(pathname)) return reply.code(404).send();
      file = resolve(config.webRoot, "index.html");
    }
    reply.type(contentTypes[extname(file)] ?? "application/octet-stream");
    return readFile(file);
  });
  return app;
}
