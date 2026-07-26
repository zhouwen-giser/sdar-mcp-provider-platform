import { describe, expect, it, vi } from "vitest";
import type { AuditRepository } from "../../../packages/pms-domain/src/index.js";
import { auditEventId } from "../../../packages/pms-domain/src/index.js";
import { createPmsApi, pmsOpenApiDocument } from "../src/index.js";

describe("PMS Audit query API", () => {
  it("filters through the repository and returns no metadata", async () => {
    const list = vi.fn<AuditRepository["list"]>(() =>
      Promise.resolve({
        items: [
          {
            auditEventId: auditEventId("00000000-0000-4000-8000-000000000001"),
            action: "runtime_deployment.restart",
            actorId: "admin-1",
            correlationId: "trace-1",
            subjectType: "runtime_deployment",
            subjectId: "deployment-1",
            occurredAt: new Date("2026-07-27T00:00:00.000Z"),
            metadata: {
              databaseUrl: "postgresql://private",
              secretRef: "vault/private",
            },
          },
        ],
        nextCursor: "1",
      }),
    );
    const app = createPmsApi({ audit: { list } });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/audit-events?subjectType=runtime_deployment&subjectId=deployment-1&correlationId=trace-1&occurredBefore=2026-07-28T00%3A00%3A00.000Z&limit=10",
    });

    expect(response.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith({
      subjectType: "runtime_deployment",
      subjectId: "deployment-1",
      correlationId: "trace-1",
      occurredBefore: new Date("2026-07-28T00:00:00.000Z"),
      limit: 10,
    });
    expect(response.json()).toEqual({
      items: [
        {
          auditEventId: "00000000-0000-4000-8000-000000000001",
          action: "runtime_deployment.restart",
          actorId: "admin-1",
          correlationId: "trace-1",
          subjectType: "runtime_deployment",
          subjectId: "deployment-1",
          occurredAt: "2026-07-27T00:00:00.000Z",
        },
      ],
      nextCursor: "1",
    });
    expect(response.body).not.toMatch(/metadata|postgresql|secretRef|private/i);
    await app.close();
  });

  it("documents a reader-protected read-only endpoint", () => {
    const document = pmsOpenApiDocument() as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    const operation = document.paths["/api/v1/audit-events"]?.get;
    expect(operation?.operationId).toBe("listAuditEvents");
    expect(operation?.security).toEqual([{ managementToken: [] }]);
    expect(operation?.["x-sdar-required-role"]).toBe("reader_or_administrator");
  });
});
