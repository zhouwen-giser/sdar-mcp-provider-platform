import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonToProtoStruct } from "../../../packages/adapter-protocol/src/index.js";
import {
  SMPP_DIAGNOSTIC_API_CONTRACT_HASH,
  SMPP_DIAGNOSTIC_CONTRACT,
  SMPP_DIAGNOSTIC_CONTROL_OPERATION,
  SMPP_RESPONSE_LOSS_CAPABILITY,
} from "../../../packages/provider-adapter-kit/src/index.js";
import { loadRuntimeConfig } from "../src/config.js";
import { createRuntime } from "../src/runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
});

describe("SMPP Benchmark diagnostic control API", () => {
  it("requires the scoped operator credential and proxies the frozen contract to Adapter", async () => {
    const token = "runtime-diagnostic-operator-token";
    const directory = await mkdtemp(join(tmpdir(), "sdar-diagnostic-control-"));
    temporaryDirectories.push(directory);
    const tokenFile = join(directory, "operator.token");
    await writeFile(tokenFile, token, { mode: 0o600 });
    const runtime = createRuntime(
      loadRuntimeConfig({
        RUNTIME_ENV: "test",
        PROVIDER_ID: "isr.vehicle.ugv.ugv1",
        SMPP_DIAGNOSTICS_ENABLED: "true",
        SMPP_DIAGNOSTICS_OPERATOR_TOKEN_FILE: tokenFile,
      }),
    );
    const leaseId = "11111111-1111-4111-8111-111111111111";
    const adapterStart = vi.spyOn(runtime.gateway, "startOperation").mockResolvedValue({
      result: "accepted",
      accepted: {
        externalExecutionId: `diagnostic:${leaseId}`,
        initialSnapshot: {
          taskId: "diagnostic-control",
          externalExecutionId: `diagnostic:${leaseId}`,
          state: "SUCCEEDED",
          revision: "1",
          reasonCode: "SMPP_DIAGNOSTIC_ARMED",
          message: "SMPP_DIAGNOSTIC_ARMED",
          retryable: false,
          operationName: SMPP_DIAGNOSTIC_CONTROL_OPERATION,
          argumentHash: "a".repeat(64),
          result: jsonToProtoStruct({
            contract: SMPP_DIAGNOSTIC_CONTRACT,
            capabilityId: SMPP_RESPONSE_LOSS_CAPABILITY,
            lease: { leaseId, state: "ARMED", fence: "1" },
            receipt: { action: "armed", state: "ARMED" },
          }),
        },
      },
    });
    const body = {
      contract: SMPP_DIAGNOSTIC_CONTRACT,
      action: "arm",
      idempotencyKey: "benchmark-arm-1",
      ttlMs: 60_000,
      scope: {
        runId: "run-1",
        caseId: "UGV-MCP-003",
        caseExecutionId: "case-execution-1",
        repetitionId: "repetition-1",
        selector: { operationName: "vehicle_navigate", argumentHash: "b".repeat(64) },
      },
    };

    const unauthorized = await runtime.app.inject({
      method: "POST",
      url: "/v1/diagnostics/response-loss",
      payload: body,
    });
    const armed = await runtime.app.inject({
      method: "POST",
      url: "/v1/diagnostics/response-loss",
      headers: { "x-sdar-diagnostic-token": token },
      payload: body,
    });
    const contract = await runtime.app.inject({
      method: "GET",
      url: "/v1/diagnostics/contract",
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(armed.statusCode).toBe(200);
    expect(contract.statusCode).toBe(200);
    expect(contract.json()).toMatchObject({
      contract: SMPP_DIAGNOSTIC_CONTRACT,
      contractHash: SMPP_DIAGNOSTIC_API_CONTRACT_HASH,
      routes: {
        responseLoss: { capabilityId: SMPP_RESPONSE_LOSS_CAPABILITY },
      },
      requestSchema: { type: "object" },
      responseSchema: { type: "object" },
      selector: {
        operationName: "vehicle_navigate",
        argumentHashAlgorithm: "sha256-json-recursive-object-key-sort-v1",
      },
    });
    const armScopeSchema = contract.json<{
      requestSchema: {
        oneOf: {
          properties: { scope: { required: string[]; properties: Record<string, unknown> } };
        }[];
      };
    }>().requestSchema.oneOf[0]?.properties.scope;
    expect(armScopeSchema).toBeDefined();
    expect(armScopeSchema?.required).toEqual([
      "runId",
      "caseId",
      "caseExecutionId",
      "repetitionId",
      "selector",
    ]);
    expect(armScopeSchema?.properties).not.toHaveProperty("logicalInvocationId");
    expect(armed.json()).toMatchObject({
      contract: SMPP_DIAGNOSTIC_CONTRACT,
      contractHash: SMPP_DIAGNOSTIC_API_CONTRACT_HASH,
      capabilityId: SMPP_RESPONSE_LOSS_CAPABILITY,
      lease: { leaseId, state: "ARMED", fence: "1" },
      receipt: { action: "armed", state: "ARMED" },
    });
    expect(adapterStart.mock.calls[0]?.[0]).toBe(SMPP_DIAGNOSTIC_CONTROL_OPERATION);
    expect(adapterStart.mock.calls[0]?.[1]).toEqual({
      capabilityId: SMPP_RESPONSE_LOSS_CAPABILITY,
      request: body,
    });
    const options = adapterStart.mock.calls[0]?.[2];
    expect(options?.executionMode).toBe("live");
    expect(options?.authorizationContextHash).toMatch(/^[a-f0-9]{64}$/);
    await runtime.app.close();
  });

  it("does not expose control routes when diagnostics are disabled", async () => {
    const runtime = createRuntime(
      loadRuntimeConfig({ RUNTIME_ENV: "test", PROVIDER_ID: "isr.vehicle.ugv.ugv1" }),
    );
    const response = await runtime.app.inject({
      method: "GET",
      url: "/v1/diagnostics/response-loss/11111111-1111-4111-8111-111111111111",
    });
    expect(response.statusCode).toBe(404);
    await runtime.app.close();
  });
});
