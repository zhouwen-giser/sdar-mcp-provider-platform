import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  assertJsonLimits,
  createAuthorizationResolver,
} from "../../packages/mcp-protocol/src/index.js";
import { createLogger, RuntimeMetrics } from "../../packages/observability/src/index.js";

describe("Runtime security boundaries", () => {
  it("requires trusted identity and binds authorization plus execution mode", () => {
    const resolve = createAuthorizationResolver({ mode: "trusted_headers" });
    expect(() => resolve(request({}))).toThrow("AUTHENTICATION_REQUIRED");
    const live = resolve(request({ "x-sdar-subject": "alice", "x-sdar-tenant": "tenant-a" }));
    const otherUser = resolve(request({ "x-sdar-subject": "bob", "x-sdar-tenant": "tenant-a" }));
    const simulation = resolve(
      request({
        "x-sdar-subject": "alice",
        "x-sdar-tenant": "tenant-a",
        "x-sdar-execution-mode": "simulation",
        "x-sdar-simulation-id": "sim-1",
      }),
    );
    expect(live.hash).not.toBe(otherUser.hash);
    expect(simulation).toMatchObject({ hash: live.hash, executionMode: "simulation" });
    expect(() =>
      resolve(
        request({
          "x-sdar-subject": "alice",
          "x-sdar-tenant": "tenant-a",
          "x-sdar-execution-mode": "simulation",
        }),
      ),
    ).toThrow("INVALID_SIMULATION_CONTEXT");
  });

  it("verifies HS256 signature, expiry, issuer, audience, subject and tenant", () => {
    const secret = "a-production-shaped-secret-with-32-bytes";
    const resolve = createAuthorizationResolver({
      mode: "jwt_hs256",
      secret,
      issuer: "issuer-a",
      audience: "sdar-runtime",
    });
    const token = jwt(secret, {
      sub: "alice",
      tenant: "tenant-a",
      iss: "issuer-a",
      aud: "sdar-runtime",
      exp: Math.floor(Date.now() / 1_000) + 60,
    });
    expect(resolve(request({ authorization: `Bearer ${token}` })).hash).toHaveLength(64);
    expect(() => resolve(request({ authorization: `Bearer ${token.slice(0, -1)}x` }))).toThrow(
      "INVALID_BEARER_TOKEN",
    );
    expect(() =>
      resolve(
        request({
          authorization: `Bearer ${jwt(secret, {
            sub: "alice",
            tenant: "tenant-a",
            iss: "issuer-a",
            aud: "sdar-runtime",
            exp: 1,
          })}`,
        }),
      ),
    ).toThrow("JWT_EXPIRED");
  });

  it("bounds argument size/depth/nodes and redacts sensitive structured logs", async () => {
    expect(() => assertJsonLimits({ value: "x".repeat(100) }, 32, 8, 100)).toThrow(
      "ARGUMENTS_TOO_LARGE",
    );
    expect(() => assertJsonLimits({ a: { b: { c: true } } }, 1_000, 1, 100)).toThrow(
      "ARGUMENTS_TOO_DEEP",
    );
    expect(() => assertJsonLimits({ a: [1, 2, 3] }, 1_000, 8, 3)).toThrow("ARGUMENTS_TOO_COMPLEX");

    const destination = new PassThrough();
    let output = "";
    destination.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    const logger = createLogger("info", destination);
    logger.info(
      { authorization: "Bearer secret", arguments: { password: "classified" } },
      "redaction-test",
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("Bearer secret");
    expect(output).not.toContain("classified");
  });

  it("renders Prometheus counters and gauges", () => {
    const metrics = new RuntimeMetrics();
    metrics.increment("sdar_adapter_rpc_total", { method: "GetExecution", outcome: "success" });
    const rendered = metrics.render({ sdar_outbox_pending: 2 });
    expect(rendered).toContain('sdar_adapter_rpc_total{method="GetExecution",outcome="success"} 1');
    expect(rendered).toContain("sdar_outbox_pending 2");
  });
});

function request(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function jwt(secret: string, payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${claims}`).digest("base64url");
  return `${header}.${claims}.${signature}`;
}
