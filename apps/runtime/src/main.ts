import { loadRuntimeConfig } from "./config.js";
import { createRuntime } from "./runtime.js";

const config = loadRuntimeConfig();
const runtime = createRuntime(config);

async function initializeWithRetry(attempts = 20): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runtime.initialize();
      return;
    } catch (error) {
      lastError = error;
      runtime.app.log.warn({ err: error, attempt, attempts }, "dependencies are not ready");
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

async function shutdown(signal: string): Promise<void> {
  runtime.app.log.info({ signal }, "runtime shutting down");
  await runtime.app.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await initializeWithRetry();
  await runtime.app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  runtime.app.log.fatal({ err: error }, "runtime failed to start");
  await runtime.app.close();
  process.exitCode = 1;
}
