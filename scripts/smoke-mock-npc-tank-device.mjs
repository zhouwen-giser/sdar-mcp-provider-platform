/* global process */

import { MemoryProviderStore } from "../dist/packages/provider-adapter-kit/src/index.js";
import {
  npcCircularScanSupported,
  selectNpcNavigationTool,
  StreamableHttpNpcTankDeviceMcpClient,
} from "../dist/packages/vehicle-device-mcp-client/src/index.js";

const store = new MemoryProviderStore();
const client = new StreamableHttpNpcTankDeviceMcpClient(
  {
    url: process.env.NPC_TANK_DEVICE_MCP_URL ?? "http://127.0.0.1:19003/mcp",
    timeoutMs: 3000,
    maxResponseBytes: 65536,
    contractReportPath:
      process.env.NPC_TANK_DEVICE_MCP_CONTRACT_REPORT_PATH ??
      "reports/npc-tank-provider-v1/external-contract/npc-tank-device-mcp-tools.json",
    useMockContractWhenUnavailable: false,
  },
  store,
);

await client.connect();
const contracts = client.contracts();
const navigation = selectNpcNavigationTool(contracts);
const laser = await client.call("npc_tank_laser_range", {});
process.stdout.write(
  `${JSON.stringify({
    status: "PASS",
    tools: contracts.length,
    connected: client.connected(),
    navigation,
    circularScanSupported: npcCircularScanSupported(contracts),
    laser,
  })}\n`,
);
await client.close();
