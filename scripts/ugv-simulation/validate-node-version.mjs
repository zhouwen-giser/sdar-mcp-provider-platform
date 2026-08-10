import { safeFailure, validateNodeVersion } from "./lib.mjs";

try {
  validateNodeVersion();
} catch (error) {
  const failure = safeFailure(error, "NODE_VERSION_VALIDATION_FAILED");
  process.stderr.write(`BLOCKED_CONFIGURATION: ${failure.reasonCode}\n`);
  process.exitCode = 2;
}
