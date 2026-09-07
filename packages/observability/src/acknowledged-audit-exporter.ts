import { ExportResultCode } from "@opentelemetry/core";
import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { JsonLogsSerializer } from "@opentelemetry/otlp-transformer";
import { request as requestHttp, type ClientRequest } from "node:http";
import { request as requestHttps } from "node:https";

/** Audit delivery requires a complete OTLP acknowledgement, including partial rejection checks. */
export class AcknowledgedAuditHttpExporter implements LogRecordExporter {
  readonly #pending = new Set<Promise<void>>();
  readonly #endpoint: URL;
  #closed = false;

  constructor(
    readonly options: {
      url: string;
      headers?: Record<string, string>;
      timeoutMillis: number;
      tls?: { ca: Buffer; cert: Buffer; key: Buffer };
    },
  ) {
    this.#endpoint = new URL(options.url);
    if (this.#endpoint.protocol !== "http:" && this.#endpoint.protocol !== "https:")
      throw new Error("TELEMETRY_AUDIT_ENDPOINT_INVALID");
  }

  export(records: ReadableLogRecord[], callback: Parameters<LogRecordExporter["export"]>[1]): void {
    if (this.#closed) {
      callback({
        code: ExportResultCode.FAILED,
        error: new Error("TELEMETRY_AUDIT_EXPORT_UNAVAILABLE"),
      });
      return;
    }
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#pending.add(pending);
    let settled = false;
    let request: ClientRequest | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.#pending.delete(pending);
      release();
      if (error !== undefined) request?.destroy();
      callback(
        error === undefined
          ? { code: ExportResultCode.SUCCESS }
          : { code: ExportResultCode.FAILED, error },
      );
    };
    const timer = setTimeout(
      () => finish(new Error("TELEMETRY_AUDIT_HTTP_TIMEOUT")),
      this.options.timeoutMillis,
    );
    try {
      const payload = JsonLogsSerializer.serializeRequest(records);
      if (payload === undefined) throw new Error("TELEMETRY_AUDIT_SERIALIZATION_FAILED");
      const headers = Object.fromEntries(
        Object.entries(this.options.headers ?? {}).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      );
      request = (this.#endpoint.protocol === "https:" ? requestHttps : requestHttp)(
        this.#endpoint,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "content-length": payload.byteLength,
            accept: "application/json",
            "accept-encoding": "identity",
          },
          ...(this.options.tls === undefined
            ? {}
            : { ...this.options.tls, rejectUnauthorized: true }),
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            finish(new Error("TELEMETRY_AUDIT_HTTP_REJECTED"));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 1_048_576) {
              response.destroy();
              finish(new Error("TELEMETRY_AUDIT_RESPONSE_TOO_LARGE"));
            } else chunks.push(chunk);
          });
          response.on("error", () => finish(new Error("TELEMETRY_AUDIT_RESPONSE_INCOMPLETE")));
          response.on("aborted", () => finish(new Error("TELEMETRY_AUDIT_RESPONSE_INCOMPLETE")));
          response.on("end", () => {
            try {
              assertCompleteAcknowledgement(Buffer.concat(chunks).toString("utf8"));
              finish();
            } catch (error) {
              finish(
                error instanceof Error ? error : new Error("TELEMETRY_AUDIT_RESPONSE_INVALID"),
              );
            }
          });
        },
      );
      request.on("error", () => finish(new Error("TELEMETRY_AUDIT_HTTP_FAILED")));
      request.end(payload);
    } catch {
      finish(new Error("TELEMETRY_AUDIT_EXPORT_FAILED"));
    }
  }

  async forceFlush(): Promise<void> {
    await Promise.all([...this.#pending]);
  }
  async shutdown(): Promise<void> {
    this.#closed = true;
    await this.forceFlush();
  }
}

function assertCompleteAcknowledgement(body: string): void {
  let response: unknown;
  try {
    response = JSON.parse(body);
  } catch {
    throw new Error("TELEMETRY_AUDIT_RESPONSE_INVALID");
  }
  if (
    !object(response) ||
    Object.keys(response).some((key) => key !== "partialSuccess" && key !== "partial_success")
  )
    throw new Error("TELEMETRY_AUDIT_RESPONSE_INVALID");
  if (Object.hasOwn(response, "partialSuccess") && Object.hasOwn(response, "partial_success"))
    throw new Error("TELEMETRY_AUDIT_RESPONSE_INVALID");
  const partial = Object.hasOwn(response, "partialSuccess")
    ? response.partialSuccess
    : response.partial_success;
  if (partial === undefined) return;
  if (
    !object(partial) ||
    Object.keys(partial).some(
      (key) =>
        !["rejectedLogRecords", "rejected_log_records", "errorMessage", "error_message"].includes(
          key,
        ),
    )
  )
    throw new Error("TELEMETRY_AUDIT_RESPONSE_INVALID");
  if (
    Object.hasOwn(partial, "rejectedLogRecords") &&
    Object.hasOwn(partial, "rejected_log_records")
  )
    throw new Error("TELEMETRY_AUDIT_RESPONSE_INVALID");
  const rejected = Object.hasOwn(partial, "rejectedLogRecords")
    ? partial.rejectedLogRecords
    : partial.rejected_log_records;
  const message = Object.hasOwn(partial, "errorMessage")
    ? partial.errorMessage
    : partial.error_message;
  if (message !== undefined && typeof message !== "string")
    throw new Error("TELEMETRY_AUDIT_RESPONSE_INVALID");
  if (rejected === undefined || rejected === "0" || rejected === 0) return;
  if (
    (typeof rejected === "number" && Number.isInteger(rejected) && rejected > 0) ||
    (typeof rejected === "string" && /^[1-9][0-9]*$/.test(rejected))
  )
    throw new Error("TELEMETRY_AUDIT_PARTIAL_REJECTION");
  throw new Error("TELEMETRY_AUDIT_RESPONSE_INVALID");
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
