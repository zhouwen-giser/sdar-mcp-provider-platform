import { loadRuntimeConfig } from "./config.js";
import { createRuntime } from "./runtime.js";
import { loadRuntimeConfigClientBootstrap, RuntimeConfigIntegration } from "./runtime-config.js";
import { createRuntimeShutdown } from "./shutdown.js";
import {
  loadRuntimeRegistrationBootstrap,
  RuntimeRegistrationIntegration,
} from "./runtime-registration.js";

const config = loadRuntimeConfig();
const runtime = createRuntime(config);
const runtimeConfigBootstrap = loadRuntimeConfigClientBootstrap(config);
const runtimeConfig =
  runtimeConfigBootstrap === null
    ? null
    : new RuntimeConfigIntegration(runtimeConfigBootstrap, runtime, runtime.app.log);
const runtimeRegistrationBootstrap = loadRuntimeRegistrationBootstrap(config);
const runtimeRegistration =
  runtimeRegistrationBootstrap === null
    ? null
    : new RuntimeRegistrationIntegration(
        runtimeRegistrationBootstrap,
        () => ({
          configRevision: runtimeConfig?.currentRevision() ?? 0,
          readinessState: runtime.registrationReadiness(),
        }),
        runtime.app.log,
      );

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

const shutdown = createRuntimeShutdown({
  beginDrain: () => {
    runtime.beginDrain();
  },
  stopConfig: async () => {
    await Promise.all([
      runtimeConfig?.stop() ?? Promise.resolve(),
      runtimeRegistration?.stop() ?? Promise.resolve(),
    ]);
  },
  closeRuntime: () => runtime.app.close(),
  onBegin: (signal) =>
    runtime.app.log.info({ signal }, "runtime draining before graceful shutdown"),
});

function onSignal(signal: "SIGINT" | "SIGTERM"): void {
  void shutdown(signal).catch((error: unknown) => {
    runtime.app.log.error({ err: error, signal }, "runtime graceful shutdown failed");
    process.exitCode = 1;
  });
}

process.once("SIGINT", () => onSignal("SIGINT"));
process.once("SIGTERM", () => onSignal("SIGTERM"));

try {
  await runtime.app.listen({ host: config.HOST, port: config.PORT });
  runtimeRegistration?.start();
  await initializeWithRetry();
  runtimeConfig?.start();
} catch (error) {
  runtime.app.log.fatal({ err: error }, "runtime failed to start");
  await runtimeConfig?.stop();
  await runtimeRegistration?.stop();
  await runtime.app.close();
  process.exitCode = 1;
}
