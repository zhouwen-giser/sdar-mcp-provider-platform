import Fastify from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type * as grpc from "@grpc/grpc-js";
import { afterEach, describe, expect, it } from "vitest";
import { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.js";
import { McpProtocolHandler } from "../../packages/mcp-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import {
  bindMockAdapter,
  createMockAdapterServer,
} from "../../examples/mock-adapter-typescript/src/server.js";

let adapter: grpc.Server | undefined;
let gateway: GrpcAdapterGateway | undefined;

afterEach(async () => {
  gateway?.close();
  if (adapter !== undefined)
    await new Promise<void>((resolve) => adapter?.tryShutdown(() => resolve()));
});

describe("MCP dynamic Tool catalog", () => {
  it("lists Manifest operations and executes a synchronous Tool", async () => {
    adapter = createMockAdapterServer({ providerId: "mcp-provider" });
    const adapterPort = await bindMockAdapter(adapter, "127.0.0.1:0");
    gateway = new GrpcAdapterGateway({
      endpoint: `127.0.0.1:${String(adapterPort)}`,
      providerId: "mcp-provider",
    });
    const validated = new OperationRegistry().validate(await gateway.describeProvider());
    const handler = new McpProtocolHandler(validated, gateway);
    const app = Fastify();
    app.post("/mcp", async (request, reply) => {
      reply.hijack();
      await handler.handle(request.raw, reply.raw, request.body);
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string")
      throw new Error("HTTP server did not bind");
    const client = new Client({ name: "r2-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${String(address.port)}/mcp`),
    );
    await client.connect(transport as unknown as Transport);
    try {
      expect(client.getServerCapabilities()).toMatchObject({
        tasks: { requests: { tools: { call: {} } } },
        extensions: {
          "io.modelcontextprotocol/tasks": {},
          "io.sdar/taskExecution": { version: "1.0", scheduling: true },
        },
      });
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "echo_sync",
        "durable_task",
        "flex_task",
      ]);
      const result = await client.callTool({ name: "echo_sync", arguments: { message: "hello" } });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toEqual({ message: "hello" });
    } finally {
      await client.close();
      await app.close();
    }
  });
});
