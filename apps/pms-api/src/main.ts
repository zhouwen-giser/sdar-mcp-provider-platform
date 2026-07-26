import { createPmsApi } from "./app.js";
import { loadProviderPackageQueryService } from "../../../packages/pms-application/src/index.js";

const port = boundedPort(process.env.PMS_API_PORT);
const host = process.env.PMS_API_HOST ?? "127.0.0.1";
const app = createPmsApi({
  providerPackages: await loadProviderPackageQueryService(),
});

await app.listen({ host, port });

async function stop(): Promise<void> {
  await app.close();
}

function onSignal(): void {
  void stop().catch(() => {
    process.exitCode = 1;
  });
}

process.once("SIGTERM", onSignal);
process.once("SIGINT", onSignal);

function boundedPort(source: string | undefined): number {
  const value = source === undefined ? 8090 : Number(source);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error("PMS_API_PORT_INVALID");
  }
  return value;
}
