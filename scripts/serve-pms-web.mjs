import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CONSOLE_API_BASE = "/api/console/v1";
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const root = resolve(
  process.env.PMS_WEB_ROOT ??
    resolve(dirname(fileURLToPath(import.meta.url)), "../apps/pms-web/dist"),
);
const host = process.env.PMS_WEB_HOST ?? "127.0.0.1";
const port = parsePort(process.env.PMS_WEB_PORT ?? "5173");
const dataMode = parseDataMode(process.env.PMS_WEB_DATA_MODE ?? "api");
const browserApiBase = parseBrowserApiBase(process.env.PMS_WEB_API_BASE ?? CONSOLE_API_BASE);
const apiUpstream = parseApiUpstream(process.env.PMS_WEB_API_UPSTREAM ?? "http://127.0.0.1:8090");
const maxBodyBytes = parseBoundedInteger(
  process.env.PMS_WEB_PROXY_MAX_BODY_BYTES,
  DEFAULT_MAX_BODY_BYTES,
  1,
  16 * 1_048_576,
  "PMS_WEB_PROXY_MAX_BODY_BYTES_INVALID",
);
const upstreamTimeoutMs = parseBoundedInteger(
  process.env.PMS_WEB_PROXY_TIMEOUT_MS,
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  10,
  120_000,
  "PMS_WEB_PROXY_TIMEOUT_MS_INVALID",
);
const rawApiProxyEnabled = parseBooleanFlag(
  process.env.PMS_WEB_RAW_API_PROXY_ENABLED,
  "PMS_WEB_RAW_API_PROXY_ENABLED_INVALID",
);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    if (response.destroyed || isClientAbort(error)) return;
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error instanceof HttpProblem) {
      writeProblem(response, error.status, error.code, error.title);
      return;
    }
    writeProblem(response, 500, "PMS_WEB_SERVER_ERROR", "Internal Server Error");
  });
});

server.on("clientError", (_error, socket) => {
  if (!socket.writable) return;
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
});

server.listen(port, host, () => {
  const address = server.address();
  const activePort = typeof address === "object" && address !== null ? address.port : port;
  console.log(
    `PMS_WEB_READY host=${host} port=${String(activePort)} mode=${dataMode} apiBase=${browserApiBase}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) {
        console.error("PMS_WEB_SERVER_SHUTDOWN_FAILED");
        process.exitCode = 1;
      }
    });
  });
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? "/", "http://pms-web.invalid");
  if (["/health/live", "/health/ready"].includes(requestUrl.pathname)) {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end('{"status":"ok"}\n');
    return;
  }

  if (
    isConsoleApiPath(requestUrl.pathname) ||
    (rawApiProxyEnabled && isRawApiPath(requestUrl.pathname))
  ) {
    await proxyApi(request, response, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/")) {
    request.resume();
    writeProblem(response, 404, "PMS_WEB_API_ROUTE_NOT_ALLOWED", "Not Found");
    return;
  }

  await serveStatic(response, requestUrl.pathname);
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PMS_WEB_PORT_INVALID");
  }
  return port;
}

function parseBrowserApiBase(value) {
  const source = value.trim();
  if (source !== CONSOLE_API_BASE && source !== `${CONSOLE_API_BASE}/`) {
    throw new Error("PMS_WEB_API_BASE_INVALID");
  }
  return CONSOLE_API_BASE;
}

function parseDataMode(value) {
  if (value !== "api") throw new Error("PMS_WEB_DATA_MODE_INVALID");
  return value;
}

function parseApiUpstream(value) {
  let upstream;
  try {
    upstream = new URL(value);
  } catch {
    throw new Error("PMS_WEB_API_UPSTREAM_INVALID");
  }
  if (
    !["http:", "https:"].includes(upstream.protocol) ||
    upstream.username.length > 0 ||
    upstream.password.length > 0 ||
    (upstream.pathname !== "" && upstream.pathname !== "/") ||
    upstream.search.length > 0 ||
    upstream.hash.length > 0
  ) {
    throw new Error("PMS_WEB_API_UPSTREAM_INVALID");
  }
  upstream.pathname = "/";
  return upstream;
}

function parseBoundedInteger(source, fallback, minimum, maximum, code) {
  const value = source === undefined ? fallback : Number(source);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(code);
  }
  return value;
}

function parseBooleanFlag(source, code) {
  if (source === undefined || source === "false") return false;
  if (source === "true") return true;
  throw new Error(code);
}

function isConsoleApiPath(pathname) {
  return pathname === CONSOLE_API_BASE || pathname.startsWith(`${CONSOLE_API_BASE}/`);
}

function isRawApiPath(pathname) {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = resolve(root, `.${requested}`);
  const isWithinRoot = file === root || file.startsWith(`${root}${sep}`);
  const fallback = resolve(root, "index.html");
  const target =
    isWithinRoot && (await exists(file)) && (await stat(file)).isFile() ? file : fallback;

  response.writeHead(200, {
    "content-type": contentTypes[extname(target)] ?? "application/octet-stream",
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (target === fallback) {
    const html = await readFile(fallback, "utf8");
    const runtimeConfig = [
      `<meta name="pms-web-data-mode" content="${escapeHtml(dataMode)}">`,
      `<meta name="pms-web-api-base" content="${escapeHtml(browserApiBase)}">`,
    ].join("\n  ");
    response.end(html.replace("</head>", `  ${runtimeConfig}\n  </head>`));
    return;
  }
  createReadStream(target).pipe(response);
}

async function proxyApi(request, response, requestUrl) {
  const method = request.method ?? "GET";
  const requestBody = await readBody(request, maxBodyBytes);
  const body = ["GET", "HEAD"].includes(method) ? undefined : requestBody;
  if (request.aborted || response.destroyed) throw new ClientAbort();

  const target = new URL(apiUpstream);
  target.pathname = requestUrl.pathname;
  target.search = requestUrl.search;
  await streamUpstreamResponse({
    body,
    method,
    request,
    response,
    target,
  });
}

async function streamUpstreamResponse({ body, method, request, response, target }) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timedOut = false;
    let clientAborted = false;
    let upstreamResponse;
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      request.off("aborted", abortForClient);
      response.off("close", abortForClient);
      response.off("finish", succeed);
      upstreamResponse?.off("aborted", upstreamAborted);
      upstreamResponse?.off("error", upstreamErrored);
      callback();
    };
    const succeed = () => settle(resolvePromise);
    const fail = (error) => settle(() => rejectPromise(error));
    const upstreamAborted = () => {
      fail(new HttpProblem(502, "PMS_WEB_UPSTREAM_BAD_GATEWAY", "Bad Gateway"));
    };
    const upstreamErrored = () => {
      fail(new HttpProblem(502, "PMS_WEB_UPSTREAM_BAD_GATEWAY", "Bad Gateway"));
    };
    const abortForClient = () => {
      if (response.writableEnded) return;
      clientAborted = true;
      upstreamResponse?.destroy();
      upstreamRequest.destroy();
      fail(new ClientAbort());
    };
    const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
    const upstreamRequest = transport(
      target,
      {
        method,
        headers: filterHeaders(request.headers, ["host", "content-length"]),
      },
      (candidate) => {
        upstreamResponse = candidate;
        if (isEventStream(upstreamResponse.headers["content-type"])) clearTimeout(timeout);
        upstreamResponse.once("aborted", upstreamAborted);
        upstreamResponse.once("error", upstreamErrored);
        response.once("finish", succeed);
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          filterHeaders(upstreamResponse.headers),
        );
        if (method === "HEAD") {
          upstreamResponse.resume();
          upstreamResponse.once("end", () => response.end());
        } else {
          upstreamResponse.pipe(response);
        }
      },
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      upstreamRequest.destroy();
      fail(new HttpProblem(504, "PMS_WEB_UPSTREAM_TIMEOUT", "Gateway Timeout"));
    }, upstreamTimeoutMs);
    timeout.unref();

    request.once("aborted", abortForClient);
    response.once("close", abortForClient);
    upstreamRequest.once("error", () => {
      if (timedOut) {
        fail(new HttpProblem(504, "PMS_WEB_UPSTREAM_TIMEOUT", "Gateway Timeout"));
      } else if (clientAborted) {
        fail(new ClientAbort());
      } else {
        fail(new HttpProblem(502, "PMS_WEB_UPSTREAM_BAD_GATEWAY", "Bad Gateway"));
      }
    });
    upstreamRequest.end(body);
  });
}

function isEventStream(contentType) {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return typeof value === "string" && value.toLowerCase().startsWith("text/event-stream");
}

function filterHeaders(headers, additionallyBlocked = []) {
  const blocked = new Set([...HOP_BY_HOP_HEADERS, ...additionallyBlocked]);
  for (const token of headerTokens(headers.connection)) blocked.add(token);
  for (const token of headerTokens(headers["proxy-connection"])) blocked.add(token);
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) => value !== undefined && !blocked.has(name.toLowerCase()),
    ),
  );
}

function headerTokens(value) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(entry));
}

async function readBody(request, limit) {
  const declaredLength = request.headers["content-length"];
  if (declaredLength !== undefined) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      request.resume();
      throw new HttpProblem(400, "PMS_WEB_REQUEST_INVALID", "Bad Request");
    }
    if (length > limit) {
      request.resume();
      throw new HttpProblem(413, "PMS_WEB_REQUEST_BODY_TOO_LARGE", "Payload Too Large");
    }
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let size = 0;
    let finished = false;
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("aborted", onAborted);
      request.off("error", onError);
    };
    const finish = (callback) => {
      if (finished) return;
      finished = true;
      cleanup();
      callback();
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        request.resume();
        finish(() =>
          rejectPromise(
            new HttpProblem(413, "PMS_WEB_REQUEST_BODY_TOO_LARGE", "Payload Too Large"),
          ),
        );
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(() => resolvePromise(Buffer.concat(chunks)));
    const onAborted = () => finish(() => rejectPromise(new ClientAbort()));
    const onError = () => finish(() => rejectPromise(new ClientAbort()));
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
  });
}

function writeProblem(response, status, code, title) {
  const body = `${JSON.stringify({ status, code, title })}\n`;
  response.writeHead(status, {
    "content-type": "application/problem+json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

class HttpProblem extends Error {
  constructor(status, code, title) {
    super(code);
    this.status = status;
    this.code = code;
    this.title = title;
  }
}

class ClientAbort extends Error {
  constructor() {
    super("PMS_WEB_CLIENT_ABORTED");
  }
}

function isClientAbort(error) {
  return error instanceof ClientAbort;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
