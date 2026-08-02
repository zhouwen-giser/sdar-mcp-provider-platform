import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(
  process.env.PMS_WEB_ROOT ??
    resolve(dirname(fileURLToPath(import.meta.url)), "../apps/pms-web/dist"),
);
const host = process.env.PMS_WEB_HOST ?? "127.0.0.1";
const port = parsePort(process.env.PMS_WEB_PORT ?? "5173");
const apiOrigin = new URL(
  process.env.PMS_WEB_API_BASE ?? process.env.PMS_WEB_API_ORIGIN ?? "http://127.0.0.1:8090",
);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
    if (["/health/live", "/health/ready"].includes(requestUrl.pathname)) {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end('{"status":"ok"}\n');
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      await proxyApi(request, response, requestUrl);
      return;
    }

    await serveStatic(response, requestUrl.pathname);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "PMS_WEB_SERVER_ERROR");
  }
});

server.listen(port, host, () => {
  console.log(`PMS Web: http://${host}:${port}/configuration`);
  console.log(`PMS API proxy: ${apiOrigin.origin}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
  });
}

function parsePort(value) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PMS_WEB_PORT_INVALID");
  }
  return port;
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
    "cache-control": target === fallback ? "no-cache" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (target === fallback) {
    const html = await readFile(fallback, "utf8");
    const runtimeConfig = `<meta name="pms-web-api-base" content="${escapeHtml(
      apiOrigin.href.replace(/\/$/, ""),
    )}">`;
    response.end(html.replace("</head>", `  ${runtimeConfig}\n  </head>`));
    return;
  }
  createReadStream(target).pipe(response);
}

async function proxyApi(request, response, requestUrl) {
  const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, apiOrigin);
  const body = ["GET", "HEAD"].includes(request.method ?? "GET")
    ? undefined
    : await readBody(request);
  const upstream = await fetch(target, {
    method: request.method,
    headers: forwardHeaders(request.headers),
    body,
  });

  const headers = Object.fromEntries(
    [...upstream.headers].filter(
      ([name]) => !["connection", "keep-alive", "transfer-encoding"].includes(name),
    ),
  );
  response.writeHead(upstream.status, headers);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

function forwardHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) =>
        value !== undefined &&
        !["connection", "host", "content-length"].includes(name.toLowerCase()),
    ),
  );
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
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
