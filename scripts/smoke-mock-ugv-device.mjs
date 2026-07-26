/* global process */

import { MemoryProviderStore } from "../dist/packages/provider-adapter-kit/src/index.js";
import { StreamableHttpUgvDeviceMcpClient } from "../dist/packages/vehicle-device-mcp-client/src/index.js";

const store = new MemoryProviderStore();
const client = new StreamableHttpUgvDeviceMcpClient(
  {
    url: process.env.UGV_DEVICE_MCP_URL ?? "http://127.0.0.1:19000/mcp",
    timeoutMs: 3000,
    maxResponseBytes: 65536,
    contractReportPath:
      process.env.UGV_DEVICE_MCP_CONTRACT_REPORT_PATH ??
      "reports/ugv-provider-v1/external-contract/ugv-device-mcp-tools.json",
    useMockContractWhenUnavailable: false,
  },
  store,
);
await client.connect();
const laser = await client.call("ugv_laser_range", {});
process.stdout.write(
  `${JSON.stringify({ tools: client.contracts().length, laser, connected: client.connected() })}\n`,
);
await client.close();
