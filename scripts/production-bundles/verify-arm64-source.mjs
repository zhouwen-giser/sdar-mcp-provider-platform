#!/usr/bin/env node

import { resolve } from "node:path";
import { ProductionBundleError } from "./lib.mjs";
import { validateArm64SourceZip } from "./arm64-source-lib.mjs";

const [archiveArgument] = process.argv.slice(2);
if (archiveArgument === undefined || process.argv.length !== 3) {
  process.stderr.write(
    "Usage: node scripts/production-bundles/verify-arm64-source.mjs <bundle.zip>\n",
  );
  process.exitCode = 2;
} else {
  try {
    const manifest = await validateArm64SourceZip(resolve(archiveArgument));
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ARM64_SOURCE_BUILD_BUNDLE_VERIFY_PASS",
          product: manifest.bundle.product,
          platform: manifest.bundle.targetPlatform,
          sourceRevision: manifest.source.revision,
          includedImageCount: manifest.deployment.includedImageCount,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    const code = error instanceof ProductionBundleError ? error.code : "ARM64_SOURCE_VERIFY_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 2;
  }
}
