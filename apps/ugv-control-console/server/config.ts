import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
export interface Credentials {
  username: string;
  salt: string;
  passwordHash: string;
  sessionSecret: string;
}
export interface Config {
  host: string;
  port: number;
  origins: string[];
  mcpUrl: string;
  databaseUrl: string;
  credentials: Credentials;
  upstreamHeaders: Record<string, string>;
  domain: string;
  webRoot: string;
  secure: boolean;
  sessionCookieName?: string;
  managementUrl?: string;
  historyDomain?: string;
  historyDomains?: string[];
  tls?: { key: Buffer; cert: Buffer };
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = (name: string) => {
    const path = env[`${name}_FILE`];
    return path ? readFileSync(path, "utf8").trim() : (env[name] ?? "");
  };
  const credentials = JSON.parse(secret("UGV_CONSOLE_CREDENTIALS")) as Credentials;
  if (
    !credentials.username ||
    !/^([a-f0-9]{2}){16,64}$/.test(credentials.salt) ||
    !/^[a-f0-9]{128}$/.test(credentials.passwordHash) ||
    credentials.sessionSecret.length < 32
  )
    throw Error("CONSOLE_CREDENTIALS_INVALID");
  const mcpUrl = env.UGV_CONSOLE_MCP_URL ?? "http://127.0.0.1:19100/mcp";
  const url = new URL(mcpUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("CONSOLE_UPSTREAM_INVALID");
  const databaseUrl = secret("UGV_CONSOLE_DATABASE_URL");
  if (!databaseUrl) throw Error("CONSOLE_DATABASE_REQUIRED");
  const upstreamHeaders: Record<string, string> = {
    "x-sdar-execution-mode": env.UGV_CONSOLE_EXECUTION_MODE ?? "live",
  };
  if (!["live", "simulation"].includes(upstreamHeaders["x-sdar-execution-mode"]))
    throw Error("CONSOLE_EXECUTION_MODE_INVALID");
  if (upstreamHeaders["x-sdar-execution-mode"] === "simulation") {
    if (!env.UGV_CONSOLE_SIMULATION_ID) throw Error("CONSOLE_SIMULATION_ID_REQUIRED");
    upstreamHeaders["x-sdar-simulation-id"] = env.UGV_CONSOLE_SIMULATION_ID;
  }
  const auth = secret("UGV_CONSOLE_UPSTREAM_AUTHORIZATION");
  if (auth) upstreamHeaders.authorization = auth;
  const port = Number(env.UGV_CONSOLE_PORT ?? 19101);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error("CONSOLE_PORT_INVALID");
  const protocol = env.UGV_CONSOLE_PROTOCOL ?? "http";
  if (protocol !== "http" && protocol !== "https") throw Error("CONSOLE_PROTOCOL_INVALID");
  const secure = protocol === "https";
  const localOnly = env.UGV_CONSOLE_INSECURE_LOCAL === "true";
  const host = env.UGV_CONSOLE_HOST ?? (localOnly ? "127.0.0.1" : "0.0.0.0");
  if (localOnly && host !== "127.0.0.1" && host !== "::1")
    throw Error("CONSOLE_INSECURE_REQUIRES_LOOPBACK");
  const origins = (
    env.UGV_CONSOLE_ORIGINS ?? `${protocol}://localhost:${port},${protocol}://127.0.0.1:${port}`
  )
    .split(",")
    .map((s) => s.trim());
  for (const origin of origins) {
    const u = new URL(origin);
    if (u.origin !== origin || u.protocol !== `${protocol}:`) throw Error("CONSOLE_ORIGIN_INVALID");
  }
  const managementUrl = env.UGV_CONSOLE_SITE_MANAGEMENT_URL;
  if (managementUrl && !/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(managementUrl))
    throw Error("CONSOLE_MANAGEMENT_URL_INVALID");
  const sessionCookieName = env.UGV_CONSOLE_SESSION_COOKIE_NAME;
  if (sessionCookieName !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(sessionCookieName))
    throw Error("CONSOLE_COOKIE_NAME_INVALID");
  const tls = secure
    ? {
        key: readFileSync(env.UGV_CONSOLE_TLS_KEY_FILE ?? "/run/secrets/tls.key"),
        cert: readFileSync(env.UGV_CONSOLE_TLS_CERT_FILE ?? "/run/secrets/tls.crt"),
      }
    : undefined;
  return {
    host,
    port,
    origins,
    mcpUrl,
    databaseUrl,
    credentials,
    upstreamHeaders,
    domain: createHash("sha256")
      .update(
        env.UGV_CONSOLE_AUTHORITY_KEY
          ? JSON.stringify({
              authority: env.UGV_CONSOLE_AUTHORITY_KEY,
              mode: upstreamHeaders["x-sdar-execution-mode"],
              simulationId: upstreamHeaders["x-sdar-simulation-id"] ?? null,
            })
          : JSON.stringify({ mcpUrl, upstreamHeaders }),
      )
      .digest("hex"),
    webRoot: resolve(env.UGV_CONSOLE_WEB_ROOT ?? "dist"),
    secure,
    ...(sessionCookieName ? { sessionCookieName } : {}),
    ...(managementUrl ? { managementUrl } : {}),
    ...(env.UGV_CONSOLE_HISTORY_DOMAIN ? { historyDomain: env.UGV_CONSOLE_HISTORY_DOMAIN } : {}),
    ...(env.UGV_CONSOLE_HISTORY_DOMAINS
      ? {
          historyDomains: env.UGV_CONSOLE_HISTORY_DOMAINS.split(",").map((v) => {
            if (!/^[a-f0-9]{64}$/.test(v)) throw Error("CONSOLE_HISTORY_DOMAIN_INVALID");
            return v;
          }),
        }
      : {}),
    ...(tls ? { tls } : {}),
  };
}
