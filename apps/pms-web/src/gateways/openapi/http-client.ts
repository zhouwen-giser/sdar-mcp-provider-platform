import type { ProblemDetailsDto } from "../../api/types.js";
import { GatewayProblem, type GatewayContext } from "../contracts/index.js";

export type QueryValue = string | number | boolean | null | undefined;
export type ConsoleQuery = Readonly<Record<string, QueryValue>>;

export interface ConsoleHttpRequest {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly query?: ConsoleQuery;
  readonly body?: unknown;
  readonly context?: GatewayContext;
}

export interface ConsoleHttpClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE_URL = "/api/console/v1";
const PROBLEM_CONTENT_TYPE = "application/problem+json";

export class ConsoleHttpClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: ConsoleHttpClientOptions = {}) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async request<T>(request: ConsoleHttpRequest): Promise<T> {
    const write = request.method !== "GET";
    const headers = new Headers({ accept: "application/json, application/problem+json" });
    if (request.body !== undefined) headers.set("content-type", "application/json");
    if (request.context?.correlationId !== undefined) {
      headers.set("x-correlation-id", request.context.correlationId);
    }
    if (write && request.context?.actorId !== undefined) {
      headers.set("x-actor-id", request.context.actorId);
    }

    const response = await this.#fetch(buildUrl(this.#baseUrl, request.path, request.query), {
      method: request.method,
      headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      ...(request.context?.signal === undefined ? {} : { signal: request.context.signal }),
    });

    if (!response.ok) await throwHttpProblem(response);
    if (response.status === 204) return undefined as T;
    if (!isJsonContentType(response.headers.get("content-type"))) {
      throw new Error(`PMS_CONSOLE_RESPONSE_CONTENT_TYPE_INVALID:${response.status}`);
    }
    return (await response.json()) as T;
  }
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/u, "");
  if (normalized.length === 0) throw new Error("PMS_CONSOLE_API_BASE_INVALID");
  return normalized;
}

function buildUrl(baseUrl: string, path: string, query: ConsoleQuery | undefined): string {
  if (!path.startsWith("/")) throw new Error("PMS_CONSOLE_API_PATH_INVALID");
  const absolute = /^[a-z][a-z\d+.-]*:\/\//iu.test(baseUrl);
  const url = new URL(`${baseUrl}${path}`, absolute ? undefined : "http://pms-web.invalid");
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
  }
  return absolute ? url.href : `${url.pathname}${url.search}`;
}

async function throwHttpProblem(response: Response): Promise<never> {
  if (response.headers.get("content-type")?.toLowerCase().includes(PROBLEM_CONTENT_TYPE)) {
    const candidate: unknown = await response.json().catch(() => undefined);
    if (isProblemDetails(candidate)) throw new GatewayProblem(candidate);
  }
  throw new Error(`PMS_CONSOLE_HTTP_ERROR:${response.status}`);
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || mediaType === PROBLEM_CONTENT_TYPE;
}

function isProblemDetails(value: unknown): value is ProblemDetailsDto {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const problem = value as Readonly<Record<string, unknown>>;
  return (
    typeof problem.type === "string" &&
    typeof problem.title === "string" &&
    typeof problem.status === "number" &&
    Number.isInteger(problem.status) &&
    problem.status >= 400 &&
    problem.status <= 599 &&
    typeof problem.code === "string" &&
    (problem.detail === undefined || typeof problem.detail === "string") &&
    (problem.requestId === undefined || typeof problem.requestId === "string") &&
    (problem.correlationId === undefined || typeof problem.correlationId === "string")
  );
}
