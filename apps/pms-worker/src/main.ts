import { bootstrapPmsWorker } from "./bootstrap.js";

const running = await bootstrapPmsWorker();
let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await running.stop();
}

function onSignal(): void {
  void stop().catch(() => {
    process.exitCode = 1;
  });
}

process.once("SIGTERM", onSignal);
process.once("SIGINT", onSignal);
