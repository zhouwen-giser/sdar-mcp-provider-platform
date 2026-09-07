import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AcknowledgedAuditHttpExporter } from "../../packages/observability/src/acknowledged-audit-exporter.js";
import {
  createProviderOpsEnvelope,
  ProviderTelemetry,
} from "../../packages/observability/src/index.js";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});
const resource = {
  serviceVersion: "1.1.0",
  instanceId: "http-audit-instance",
  deploymentEnvironment: "test",
  providerId: "http-audit-provider",
  providerVersion: "1.0.0",
};

describe("strict OTLP audit HTTP acknowledgement", () => {
  it.each([
    { name: "complete", status: 200, body: "{}", accepted: true },
    {
      name: "zero rejected with warning",
      status: 200,
      body: '{"partialSuccess":{"rejectedLogRecords":"0","errorMessage":"warning"}}',
      accepted: true,
    },
    {
      name: "zero rejected numeric",
      status: 200,
      body: '{"partialSuccess":{"rejectedLogRecords":0}}',
      accepted: true,
    },
    { name: "empty partial success", status: 200, body: '{"partialSuccess":{}}', accepted: true },
    {
      name: "rejected records",
      status: 200,
      body: '{"partialSuccess":{"rejectedLogRecords":"1","errorMessage":"private response detail"}}',
      accepted: false,
    },
    {
      name: "snake case rejected records",
      status: 200,
      body: '{"partial_success":{"rejected_log_records":1}}',
      accepted: false,
    },
    {
      name: "negative rejection count",
      status: 200,
      body: '{"partialSuccess":{"rejectedLogRecords":-1}}',
      accepted: false,
    },
    { name: "malformed JSON", status: 200, body: "not JSON", accepted: false },
    { name: "empty response", status: 200, body: "", accepted: false },
    { name: "unexpected object", status: 200, body: '{"error":"failed"}', accepted: false },
    { name: "array response", status: 200, body: "[]", accepted: false },
    { name: "null response", status: 200, body: "null", accepted: false },
    { name: "null partial success", status: 200, body: '{"partialSuccess":null}', accepted: false },
    {
      name: "null rejection count",
      status: 200,
      body: '{"partialSuccess":{"rejectedLogRecords":null}}',
      accepted: false,
    },
    { name: "queued response", status: 202, body: "{}", accepted: false },
    { name: "HTTP unavailable", status: 503, body: "{}", accepted: false },
  ])("$name", async ({ status, body, accepted }) => {
    const requests: unknown[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        response.writeHead(status, { "content-type": "application/json" });
        response.end(body);
      });
    });
    const url = await listen(server);
    const telemetry = setup(new AcknowledgedAuditHttpExporter({ url, timeoutMillis: 1000 }));
    const outcome = telemetry.exportAudit([envelope()]);
    if (accepted) await expect(outcome).resolves.toBeUndefined();
    else await expect(outcome).rejects.toThrow("TELEMETRY_AUDIT_EXPORT_FAILED");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      resourceLogs: [{ scopeLogs: [{ logRecords: [{ eventName: "provider.task.lifecycle" }] }] }],
    });
  });

  it("uses strict acknowledgement on the default audit transport", async () => {
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"partialSuccess":{"rejectedLogRecords":"1"}}');
      });
    });
    const url = await listen(server);
    const telemetry = new ProviderTelemetry({
      resource,
      enabled: true,
      otlpEndpoint: url.replace(/\/v1\/logs$/, ""),
      otlpTimeoutMillis: 1000,
      batch: { exportTimeoutMillis: 1000 },
    });
    telemetry.start();
    cleanup.push(() => telemetry.shutdown());
    await expect(telemetry.exportAudit([envelope()])).rejects.toThrow(
      "TELEMETRY_AUDIT_EXPORT_FAILED",
    );
  });

  it("authenticates the server and supplies the configured mTLS client certificate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-mtls-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const keyPath = join(dir, "test.key");
    const certPath = join(dir, "test.crt");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-days",
        "1",
      ],
      { stdio: "ignore" },
    );
    const key = readFileSync(keyPath);
    const cert = readFileSync(certPath);
    let authenticated = 0;
    const server = createHttpsServer(
      { key, cert, ca: cert, requestCert: true, rejectUnauthorized: true },
      (request, response) => {
        request.resume();
        request.on("end", () => {
          authenticated++;
          response.writeHead(200, { "content-type": "application/json" });
          response.end("{}");
        });
      },
    );
    const url = (await listen(server)).replace("http:", "https:");
    const telemetry = setup(
      new AcknowledgedAuditHttpExporter({ url, timeoutMillis: 1000, tls: { ca: cert, cert, key } }),
    );
    await expect(telemetry.exportAudit([envelope()])).resolves.toBeUndefined();
    const noCredentials = setup(new AcknowledgedAuditHttpExporter({ url, timeoutMillis: 1000 }));
    await expect(noCredentials.exportAudit([envelope()])).rejects.toThrow(
      "TELEMETRY_AUDIT_EXPORT_FAILED",
    );
    expect(authenticated).toBe(1);
  });
});

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server did not bind");
  return `http://127.0.0.1:${address.port}/v1/logs`;
}

function setup(auditExporter: AcknowledgedAuditHttpExporter) {
  const telemetry = new ProviderTelemetry({
    resource,
    enabled: true,
    auditExporter,
    batch: { exportTimeoutMillis: 1000 },
  });
  telemetry.start();
  cleanup.push(() => telemetry.shutdown());
  return telemetry;
}

function envelope() {
  return createProviderOpsEnvelope({
    recordType: "provider.task.lifecycle",
    eventCategory: "task.lifecycle",
    deliveryClass: "audit",
    providerId: "http-audit-provider",
    runtimeVersion: "1.1.0",
    instanceId: "http-audit-instance",
    taskId: "http-audit-task",
    stableAggregateIdentity: "http-audit-task",
    eventIdentity: "http-audit-task:started",
    occurredAt: "2026-01-01T00:00:00.123Z",
    attributes: { source: "test" },
    payload: { currentState: "RUNNING" },
  });
}
