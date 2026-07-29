import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export interface PmsWebServerOptions {
  readonly root: string;
  readonly apiBase: string;
}

const SECURITY_HEADERS = Object.freeze({
  "content-security-policy":
    "default-src 'self'; connect-src 'self' http: https:; img-src 'self' data:; " +
    "style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

export async function createPmsWebServer(options: PmsWebServerOptions): Promise<Server> {
  const root = await canonicalDirectory(options.root);
  const apiBase = validateApiBase(options.apiBase);
  const index = injectApiBase(await readFile(resolve(root, "index.html"), "utf8"), apiBase);
  return createServer(async (request, response) => {
    try {
      applySecurityHeaders(response);
      if (!["GET", "HEAD"].includes(request.method ?? "")) {
        response.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      const path = new URL(request.url ?? "/", "http://pms-web.invalid").pathname;
      if (path === "/health/live" || path === "/health/ready") {
        send(response, request.method, 200, "application/json; charset=utf-8", '{"status":"ok"}\n');
        return;
      }
      const candidate = path === "/" ? resolve(root, "index.html") : resolve(root, `.${path}`);
      if (contained(root, candidate) && (await regularFile(candidate))) {
        send(
          response,
          request.method,
          200,
          contentType(candidate),
          candidate === resolve(root, "index.html") ? index : await readFile(candidate),
        );
        return;
      }
      if (extname(path).length === 0) {
        send(response, request.method, 200, "text/html; charset=utf-8", index);
        return;
      }
      send(response, request.method, 404, "text/plain; charset=utf-8", "Not found\n");
    } catch {
      send(response, request.method, 500, "text/plain; charset=utf-8", "Internal error\n");
    }
  });
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const port = integer(process.env.PMS_WEB_PORT, 8080);
  const host = process.env.PMS_WEB_HOST ?? "0.0.0.0";
  const server = await createPmsWebServer({
    root,
    apiBase: process.env.PMS_WEB_API_BASE ?? "",
  });
  server.listen(port, host);
  const close = (): void => {
    server.close((error) => {
      if (error !== undefined) process.exitCode = 1;
    });
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

function applySecurityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
}

function send(
  response: {
    setHeader(name: string, value: string | number): void;
    writeHead(
      status: number,
      headers?: Readonly<Record<string, string>>,
    ): {
      end(body?: string | Buffer): void;
    };
  },
  method: string | undefined,
  status: number,
  type: string,
  body: string | Buffer,
): void {
  response.setHeader("content-type", type);
  response.setHeader(
    "cache-control",
    type.startsWith("text/html") ? "no-store" : "public, max-age=300",
  );
  response.setHeader("content-length", Buffer.byteLength(body));
  response.writeHead(status).end(method === "HEAD" ? undefined : body);
}

async function canonicalDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("PMS_WEB_ROOT_INVALID");
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory()) throw new Error("PMS_WEB_ROOT_INVALID");
  return canonical;
}

async function regularFile(path: string): Promise<boolean> {
  return stat(path)
    .then((value) => value.isFile())
    .catch(() => false);
}

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

function validateApiBase(value: string): string {
  if (value === "") return "";
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error("PMS_WEB_API_BASE_INVALID");
  }
  return url.toString().replace(/\/$/, "");
}

function injectApiBase(index: string, apiBase: string): string {
  return index.replace(
    '<meta name="pms-api-base" content="" />',
    `<meta name="pms-api-base" content="${escapeAttribute(apiBase)}" />`,
  );
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function contentType(path: string): string {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
    }[extname(path)] ?? "application/octet-stream"
  );
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PMS_WEB_PORT_INVALID");
  }
  return parsed;
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  await main();
}
