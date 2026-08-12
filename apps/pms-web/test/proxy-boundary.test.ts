// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface CapturedRequest {
  readonly body: string;
  readonly headers: IncomingHttpHeaders;
  readonly method: string;
  readonly url: string;
}

interface HttpResponse {
  readonly body: string;
  readonly headers: IncomingHttpHeaders;
  readonly status: number;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const serverScript = resolve(repositoryRoot, "scripts/serve-pms-web.mjs");
const capturedRequests: CapturedRequest[] = [];
const upstreamSecret = "internal-upstream-secret-marker";

let fixtureRoot = "";
let upstream: Server;
let upstreamOrigin = "";
let web: ChildProcess;
let webOrigin = "";
let rawApiWeb: ChildProcess;
let rawApiWebOrigin = "";
let webStderr = "";
let rawApiWebStderr = "";
let abortStarted: (() => void) | undefined;
let abortObserved: (() => void) | undefined;
let rawWatchStarted: (() => void) | undefined;
let rawWatchClosed: (() => void) | undefined;

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "pms-web-proxy-boundary-"));
  await writeFile(
    join(fixtureRoot, "index.html"),
    "<!doctype html><html><head></head><body>console</body></html>\n",
  );

  upstream = createServer((request, response) => {
    void captureRequest(request).then((captured) => {
      capturedRequests.push(captured);
      if (captured.url === "/api/console/v1/slow") return;
      if (captured.url === "/api/console/v1/drop") {
        request.socket.destroy();
        return;
      }
      if (captured.url === "/api/console/v1/abort") {
        abortStarted?.();
        const observed = () => abortObserved?.();
        request.once("aborted", observed);
        response.once("close", observed);
        return;
      }
      if (captured.url.endsWith("/watch")) {
        response.writeHead(200, {
          "cache-control": "no-cache",
          "content-type": "text/event-stream; charset=utf-8",
          "x-smpp-projection-contract": "sdar-registry-v1",
        });
        response.write('event: revision\ndata: {"revision":1}\n\n');
        rawWatchStarted?.();
        const closed = () => rawWatchClosed?.();
        request.once("aborted", closed);
        response.once("close", closed);
        return;
      }

      const body = JSON.stringify({
        method: captured.method,
        path: captured.url,
        body: captured.body,
      });
      response.writeHead(201, {
        connection: "x-upstream-hop",
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json",
        "proxy-authenticate": upstreamSecret,
        "x-end-to-end": "preserved",
        "x-upstream-hop": upstreamSecret,
      });
      response.end(body);
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  upstreamOrigin = origin(upstream);

  web = spawn(process.execPath, [serverScript], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PMS_WEB_API_BASE: "/api/console/v1",
      PMS_WEB_API_UPSTREAM: upstreamOrigin,
      PMS_WEB_DATA_MODE: "api",
      PMS_WEB_HOST: "127.0.0.1",
      PMS_WEB_PORT: "0",
      PMS_WEB_PROXY_MAX_BODY_BYTES: "64",
      PMS_WEB_PROXY_TIMEOUT_MS: "75",
      PMS_WEB_ROOT: fixtureRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (web.stderr === null) throw new Error("PMS_WEB_STDERR_PIPE_REQUIRED");
  web.stderr.setEncoding("utf8");
  web.stderr.on("data", (chunk: string) => {
    webStderr += chunk;
  });
  webOrigin = await waitForWebReady(web);

  rawApiWeb = spawn(process.execPath, [serverScript], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PMS_WEB_API_BASE: "/api/console/v1",
      PMS_WEB_API_UPSTREAM: upstreamOrigin,
      PMS_WEB_DATA_MODE: "api",
      PMS_WEB_HOST: "127.0.0.1",
      PMS_WEB_PORT: "0",
      PMS_WEB_PROXY_MAX_BODY_BYTES: "64",
      PMS_WEB_PROXY_TIMEOUT_MS: "75",
      PMS_WEB_RAW_API_PROXY_ENABLED: "true",
      PMS_WEB_ROOT: fixtureRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (rawApiWeb.stderr === null) throw new Error("PMS_WEB_RAW_API_STDERR_PIPE_REQUIRED");
  rawApiWeb.stderr.setEncoding("utf8");
  rawApiWeb.stderr.on("data", (chunk: string) => {
    rawApiWebStderr += chunk;
  });
  rawApiWebOrigin = await waitForWebReady(rawApiWeb);
}, 10_000);

afterAll(async () => {
  if (web?.exitCode === null) {
    web.kill("SIGTERM");
    await Promise.race([once(web, "exit"), delay(2_000)]);
    if (web.exitCode === null) web.kill("SIGKILL");
  }
  if (rawApiWeb?.exitCode === null) {
    rawApiWeb.kill("SIGTERM");
    await Promise.race([once(rawApiWeb, "exit"), delay(2_000)]);
    if (rawApiWeb.exitCode === null) rawApiWeb.kill("SIGKILL");
  }
  if (upstream !== undefined) {
    upstream.closeAllConnections();
    upstream.close();
    await Promise.race([once(upstream, "close"), delay(2_000)]);
  }
  if (fixtureRoot.length > 0) await rm(fixtureRoot, { recursive: true, force: true });
});

describe("PMS Web production proxy boundary", () => {
  it("injects only the same-origin browser API base into HTML", async () => {
    const response = await request(`${webOrigin}/`);
    expect(response.status).toBe(200);
    expect(response.body).toContain('<meta name="pms-web-data-mode" content="api">');
    expect(response.body).toContain('<meta name="pms-web-api-base" content="/api/console/v1">');
    expect(response.body).not.toContain(upstreamOrigin);
    expect(response.body).not.toContain(upstreamSecret);
  });

  it("rejects every non-Console API path locally without reaching upstream", async () => {
    const before = capturedRequests.length;
    for (const path of [
      "/api",
      "/api/v1/runtime-config/providers/provider-1",
      "/api/v1/runtime-registration/instances/instance-1",
      "/api/arbitrary",
      "/api/console/v10/providers",
    ]) {
      const response = await request(`${webOrigin}${path}`);
      expect(response.status).toBe(404);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(JSON.parse(response.body)).toEqual({
        status: 404,
        code: "PMS_WEB_API_ROUTE_NOT_ALLOWED",
        title: "Not Found",
      });
    }
    expect(capturedRequests).toHaveLength(before);
  });

  it("forwards Console V1 paths while removing hop-by-hop and authority headers", async () => {
    const response = await request(`${webOrigin}/api/console/v1/providers?cursor=next`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-only-token",
        connection: "x-remove-me, keep-alive",
        host: "browser-controlled.invalid",
        "proxy-authorization": "must-not-forward",
        te: "trailers",
        "x-actor-id": "proxy-test",
        "x-remove-me": "must-not-forward",
      },
      body: '{"safe":true}',
    });

    expect(response.status).toBe(201);
    expect(response.headers["x-end-to-end"]).toBe("preserved");
    expect(response.headers["x-upstream-hop"]).toBeUndefined();
    expect(response.headers["proxy-authenticate"]).toBeUndefined();
    expect(response.headers.connection).not.toContain("x-upstream-hop");
    expect(JSON.parse(response.body)).toEqual({
      method: "POST",
      path: "/api/console/v1/providers?cursor=next",
      body: '{"safe":true}',
    });

    const captured = capturedRequests.at(-1);
    expect(captured?.headers.host).not.toBe("browser-controlled.invalid");
    expect(captured?.headers.authorization).toBe("Bearer test-only-token");
    expect(captured?.headers["x-actor-id"]).toBe("proxy-test");
    expect(captured?.headers["x-remove-me"]).toBeUndefined();
    expect(captured?.headers["proxy-authorization"]).toBeUndefined();
    expect(captured?.headers.te).toBeUndefined();
    expect(captured?.headers.connection).not.toContain("x-remove-me");
  });

  it("rejects oversized request bodies before contacting upstream", async () => {
    const before = capturedRequests.length;
    const body = "x".repeat(65);
    const response = await request(`${webOrigin}/api/console/v1/providers`, {
      method: "POST",
      body,
    });
    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      status: 413,
      code: "PMS_WEB_REQUEST_BODY_TOO_LARGE",
      title: "Payload Too Large",
    });
    expect(response.body).not.toContain(upstreamOrigin);
    expect(capturedRequests).toHaveLength(before);

    for (const method of ["GET", "HEAD"]) {
      const readResponse = await request(`${webOrigin}/api/console/v1/providers`, {
        method,
        headers: { "content-length": String(Buffer.byteLength(body)) },
        body,
      });
      expect(readResponse.status).toBe(413);
    }
    expect(capturedRequests).toHaveLength(before);
  });

  it("returns a fixed timeout response without leaking upstream details", async () => {
    const response = await request(`${webOrigin}/api/console/v1/slow`);
    expect(response.status).toBe(504);
    expect(JSON.parse(response.body)).toEqual({
      status: 504,
      code: "PMS_WEB_UPSTREAM_TIMEOUT",
      title: "Gateway Timeout",
    });
    expect(response.body).not.toContain(upstreamOrigin);
    expect(response.body).not.toContain(upstreamSecret);
  });

  it("returns a fixed bad-gateway response for upstream transport failures", async () => {
    const response = await request(`${webOrigin}/api/console/v1/drop`);
    expect(response.status).toBe(502);
    expect(JSON.parse(response.body)).toEqual({
      status: 502,
      code: "PMS_WEB_UPSTREAM_BAD_GATEWAY",
      title: "Bad Gateway",
    });
    expect(response.body).not.toContain(upstreamOrigin);
    expect(response.body).not.toContain(upstreamSecret);
  });

  it("cancels the upstream request when the browser disconnects", async () => {
    let signalStarted: () => void = () => undefined;
    let signalAborted: () => void = () => undefined;
    const started = new Promise<void>((resolvePromise) => {
      signalStarted = resolvePromise;
    });
    const aborted = new Promise<void>((resolvePromise) => {
      signalAborted = resolvePromise;
    });
    abortStarted = signalStarted;
    abortObserved = signalAborted;

    const client = httpRequest(`${webOrigin}/api/console/v1/abort`);
    client.on("error", () => undefined);
    client.end();
    await withTimeout(started, 2_000, "UPSTREAM_ABORT_ROUTE_NOT_REACHED");
    client.destroy();
    await withTimeout(aborted, 2_000, "UPSTREAM_ABORT_NOT_PROPAGATED");
    expect(webStderr).toBe("");
  });

  it("proxies raw API v1 only after the explicit opt-in", async () => {
    const root = await request(`${rawApiWebOrigin}/api/v1`);
    expect(root.status).toBe(201);
    expect(JSON.parse(root.body)).toMatchObject({ path: "/api/v1" });

    const projectionPath = "/api/v1/registry/production/consumers/sdar/v1/sources/sdar-node/latest";
    const projection = await request(`${rawApiWebOrigin}${projectionPath}`, {
      headers: { "if-none-match": '"projection-checksum"' },
    });
    expect(projection.status).toBe(201);
    expect(JSON.parse(projection.body)).toMatchObject({ path: projectionPath });
    expect(capturedRequests.at(-1)?.headers["if-none-match"]).toBe('"projection-checksum"');

    for (const path of ["/api/v2", "/api/raw", "/api/console/v10/providers"]) {
      const blocked = await request(`${rawApiWebOrigin}${path}`);
      expect(blocked.status, path).toBe(404);
    }
    expect(rawApiWebStderr).toBe("");
  });

  it("streams raw API watch responses and cancels the upstream on disconnect", async () => {
    let signalStarted: () => void = () => undefined;
    let signalClosed: () => void = () => undefined;
    const started = new Promise<void>((resolvePromise) => {
      signalStarted = resolvePromise;
    });
    const closed = new Promise<void>((resolvePromise) => {
      signalClosed = resolvePromise;
    });
    rawWatchStarted = signalStarted;
    rawWatchClosed = signalClosed;
    const controller = new AbortController();
    const response = await fetch(
      `${rawApiWebOrigin}/api/v1/registry/production/consumers/sdar/v1/sources/sdar-node/watch`,
      { signal: controller.signal },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-smpp-projection-contract")).toBe("sdar-registry-v1");
    await withTimeout(started, 2_000, "RAW_WATCH_NOT_STARTED");
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("RAW_WATCH_BODY_MISSING");
    const first = await withTimeout(reader.read(), 2_000, "RAW_WATCH_FIRST_EVENT_MISSING");
    expect(new TextDecoder().decode(first.value)).toContain("event: revision");
    controller.abort();
    await withTimeout(closed, 2_000, "RAW_WATCH_UPSTREAM_NOT_CANCELLED");
    expect(rawApiWebStderr).toBe("");
  });
});

async function captureRequest(request: IncomingMessage): Promise<CapturedRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return {
    body: Buffer.concat(chunks).toString("utf8"),
    headers: request.headers,
    method: request.method ?? "GET",
    url: request.url ?? "/",
  };
}

async function waitForWebReady(child: ChildProcess): Promise<string> {
  if (child.stdout === null) throw new Error("PMS_WEB_STDOUT_PIPE_REQUIRED");
  const stdout = child.stdout;
  stdout.setEncoding("utf8");
  let output = "";
  return withTimeout(
    new Promise<string>((resolvePromise, rejectPromise) => {
      stdout.on("data", (chunk: string) => {
        output += chunk;
        const match =
          /PMS_WEB_READY host=127\.0\.0\.1 port=(\d+) mode=api apiBase=\/api\/console\/v1/.exec(
            output,
          );
        if (match?.[1] !== undefined) resolvePromise(`http://127.0.0.1:${match[1]}`);
      });
      child.once("exit", (code) => {
        rejectPromise(new Error(`PMS_WEB_EXITED_BEFORE_READY:${String(code)}:${webStderr}`));
      });
      child.once("error", rejectPromise);
    }),
    5_000,
    "PMS_WEB_READY_TIMEOUT",
  );
}

function request(
  url: string,
  options: {
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly method?: string;
  } = {},
): Promise<HttpResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const client = httpRequest(
      url,
      {
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.once("end", () => {
          resolvePromise({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    client.once("error", rejectPromise);
    client.end(options.body);
  });
}

function origin(server: Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolvePromise, rejectPromise) => {
        timer = setTimeout(() => rejectPromise(new Error(code)), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
