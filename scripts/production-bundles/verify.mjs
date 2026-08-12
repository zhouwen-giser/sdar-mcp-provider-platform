#!/usr/bin/env node

import { resolve } from "node:path";
import { ProductionBundleError, validateBundleZip } from "./lib.mjs";

const [archiveArgument] = process.argv.slice(2);
if (archiveArgument === undefined || process.argv.length !== 3) {
  process.stderr.write("Usage: node scripts/production-bundles/verify.mjs <bundle.zip>\n");
  process.exitCode = 2;
} else {
  try {
    const archive = resolve(archiveArgument);
    const manifest = await validateBundleZip(archive);
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "PRODUCTION_BUNDLE_VERIFY_PASS",
          product: manifest.bundle.product,
          deployable: manifest.bundle.deployable,
          sourceRevision: manifest.source.revision,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    const code =
      error instanceof ProductionBundleError ? error.code : "PRODUCTION_BUNDLE_VERIFY_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 2;
  }
}
