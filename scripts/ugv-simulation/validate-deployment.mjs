import {
  coded,
  loadEnvironment,
  parseArguments,
  qualificationSourceState,
  repositoryRoot,
  safeFailure,
  validateDeploymentSecretFiles,
  validateNodeVersion,
} from "./lib.mjs";

try {
  validateNodeVersion();
  const argumentsValue = parseArguments(process.argv.slice(2));
  const root = argumentsValue["repo-root"] ?? repositoryRoot(import.meta.url);
  const envFile = argumentsValue["env-file"];
  if (envFile === undefined) throw coded("ENV_FILE_ARGUMENT_REQUIRED");
  const environment = loadEnvironment(envFile);
  validateDeploymentSecretFiles(environment, root);
  const source = qualificationSourceState(root);
  process.stdout.write(`${source.gitSha}\n`);
} catch (error) {
  const failure = safeFailure(error, "DEPLOYMENT_VALIDATION_FAILED");
  process.stderr.write(`BLOCKED_CONFIGURATION: ${failure.reasonCode}\n`);
  process.exitCode = 2;
}
