import { createLogger } from "../../../packages/observability/src/index.js";
import type { BusinessEventSourceCapability } from "../../../packages/adapter-protocol/src/index.js";
import { bindMockAdapter, createMockAdapterServer } from "./server.js";

const logger = createLogger(process.env.LOG_LEVEL ?? "info");
const host = process.env.ADAPTER_HOST ?? "0.0.0.0";
const port = Number(process.env.ADAPTER_PORT ?? "7001");
const businessEventSources: BusinessEventSourceCapability[] =
  process.env.BUSINESS_EVENT_SOURCE_ID === undefined
    ? []
    : [
        {
          sourceId: process.env.BUSINESS_EVENT_SOURCE_ID,
          sourceStreamId:
            process.env.BUSINESS_EVENT_SOURCE_STREAM_ID ?? "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001",
          deliverySemantics: "durable_at_least_once",
          replaySupported: true,
          sourceRetentionMs: "604800000",
          maxEventBytes: "65536",
          maxPayloadDepth: 16,
          maxPayloadNodes: 4096,
          maxPayloadStringBytes: "16384",
        },
      ];
const server = createMockAdapterServer({
  providerId: process.env.PROVIDER_ID ?? "mock-provider",
  businessEventSources,
});

try {
  const boundPort = await bindMockAdapter(server, `${host}:${String(port)}`);
  logger.info({ host, port: boundPort }, "TypeScript mock Adapter listening");
} catch (error) {
  logger.fatal({ err: error }, "TypeScript mock Adapter failed to start");
  process.exitCode = 1;
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "TypeScript mock Adapter shutting down");
  await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
