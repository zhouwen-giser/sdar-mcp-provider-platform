import { describe, expect, it } from "vitest";
import { createConsoleTestApp, SUCCESS_CASES, WRITE_HEADERS } from "./helpers.js";

describe("all frozen Console operations", () => {
  it("has a successful Fastify inject case for all 36 operations", async () => {
    expect(SUCCESS_CASES).toHaveLength(36);
    expect(new Set(SUCCESS_CASES.map(({ operationId }) => operationId)).size).toBe(36);
    const { app } = createConsoleTestApp();
    for (const testCase of SUCCESS_CASES) {
      const response = await app.inject({
        method: testCase.method,
        url: testCase.url,
        ...(testCase.method === "GET" ? {} : { headers: WRITE_HEADERS }),
        ...(testCase.payload == null ? {} : { payload: testCase.payload }),
      });
      expect(response.statusCode, testCase.operationId).toBe(testCase.status);
    }
    await app.close();
  });

  it("rejects every mutating operation when the audit actor is absent", async () => {
    const { app } = createConsoleTestApp();
    for (const testCase of SUCCESS_CASES.filter(({ method }) => method !== "GET")) {
      const response = await app.inject({
        method: testCase.method,
        url: testCase.url,
        ...(testCase.payload == null ? {} : { payload: testCase.payload }),
      });
      expect(response.statusCode, testCase.operationId).toBe(400);
      expect(response.json(), testCase.operationId).toMatchObject({ code: "INVALID_REQUEST" });
    }
    await app.close();
  });

  it("has a negative tracing-header case for all 36 operations", async () => {
    const { app } = createConsoleTestApp();
    for (const testCase of SUCCESS_CASES) {
      const response = await app.inject({
        method: testCase.method,
        url: testCase.url,
        headers: {
          "x-correlation-id": "invalid correlation",
          ...(testCase.method === "GET" ? {} : { "x-actor-id": "prototype-user" }),
        },
        ...(testCase.payload == null ? {} : { payload: testCase.payload }),
      });
      expect(response.statusCode, testCase.operationId).toBe(400);
      expect(response.json(), testCase.operationId).toMatchObject({ code: "INVALID_REQUEST" });
    }
    await app.close();
  });
});
