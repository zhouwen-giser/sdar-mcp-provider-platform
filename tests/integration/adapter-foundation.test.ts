import type * as grpc from "@grpc/grpc-js";
import { afterEach, describe, expect, it } from "vitest";
import { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.js";
import {
  bindMockAdapter,
  createMockAdapterServer,
} from "../../examples/mock-adapter-typescript/src/server.js";

let server: grpc.Server | undefined;
let gateway: GrpcAdapterGateway | undefined;

afterEach(async () => {
  gateway?.close();
  gateway = undefined;
  if (server !== undefined) {
    await new Promise<void>((resolve) => server?.tryShutdown(() => resolve()));
    server = undefined;
  }
});

describe("TypeScript Adapter foundation", () => {
  it("serves DescribeProvider over a real gRPC socket", async () => {
    server = createMockAdapterServer({ providerId: "contract-provider" });
    const port = await bindMockAdapter(server, "127.0.0.1:0");
    gateway = new GrpcAdapterGateway({
      endpoint: `127.0.0.1:${String(port)}`,
      providerId: "contract-provider",
    });

    const manifest = await gateway.describeProvider();

    expect(manifest.adapterProtocolVersion).toBe("1.0");
    expect(manifest.providerId).toBe("contract-provider");
    expect(manifest.operations.map((operation) => operation.name)).toEqual([
      "echo_sync",
      "durable_task",
      "flex_task",
    ]);
    expect(manifest.operations[0]?.execution).toBe("SYNCHRONOUS");
    expect(manifest.operations[1]?.capabilities.scheduling).toBe(true);
  });

  it("reports task and execution context from the real Adapter RPC boundary", async () => {
    server = createMockAdapterServer({ providerId: "contract-provider" });
    const port = await bindMockAdapter(server, "127.0.0.1:0");
    const calls: {
      method: string;
      outcome: "success" | "error";
      context: {
        taskId?: string;
        externalExecutionId?: string;
        operationName?: string;
        commandSequence?: number;
      };
    }[] = [];
    gateway = new GrpcAdapterGateway({
      endpoint: `127.0.0.1:${String(port)}`,
      providerId: "contract-provider",
      onRpc: (method, outcome, _durationMs, context) => calls.push({ method, outcome, context }),
    });

    await gateway.startOperation(
      "durable_task",
      { resourceId: "safe" },
      {
        taskId: "task-telemetry",
        externalExecutionId: "execution-telemetry",
      },
    );

    expect(calls).toEqual([
      {
        method: "startOperation",
        outcome: "success",
        context: {
          taskId: "task-telemetry",
          externalExecutionId: "execution-telemetry",
          operationName: "durable_task",
        },
      },
    ]);
  });
});
