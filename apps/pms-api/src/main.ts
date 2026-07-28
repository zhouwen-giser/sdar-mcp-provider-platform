import { createPmsApiComposition } from "./composition.js";
import { loadPmsApiBootstrapConfig } from "./config.js";

const config = await loadPmsApiBootstrapConfig();
const composition = await createPmsApiComposition(config);

try {
  await composition.app.listen({ host: config.host, port: config.port });
} catch (error) {
  await composition.close();
  throw error;
}

let stopping: Promise<void> | undefined;
function stop(): Promise<void> {
  stopping ??= composition.close();
  return stopping;
}

function onSignal(): void {
  void stop().catch(() => {
    process.exitCode = 1;
  });
}

process.once("SIGTERM", onSignal);
process.once("SIGINT", onSignal);
