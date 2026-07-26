import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import {
  checkConfigurationArtifactDrift,
  writeConfigurationArtifacts,
} from "../packages/runtime-configuration-contract/src/generator/index.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = resolve(root, "schemas/config");
const check = process.argv.includes("--check");

if (check) {
  const drift = await checkConfigurationArtifactDrift(outputDirectory);
  if (drift.length > 0) {
    process.stderr.write(`CONFIGURATION_SCHEMA_DRIFT\n${drift.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("CONFIGURATION_SCHEMA_CHECK_OK\n");
  }
} else {
  const artifacts = await writeConfigurationArtifacts(outputDirectory);
  process.stdout.write(`CONFIGURATION_SCHEMA_GENERATED:${artifacts.length}\n`);
}
