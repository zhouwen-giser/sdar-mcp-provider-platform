#!/usr/bin/env node

import { ProductionBundleError } from "./lib.mjs";
import { buildArm64SourceBundles, parseArm64SourceArguments } from "./arm64-source-lib.mjs";

try {
  const result = await buildArm64SourceBundles(parseArm64SourceArguments(process.argv.slice(2)));
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "ARM64_SOURCE_BUILD_BUNDLES_BUILT",
        sourceRevision: result.source.revision,
        outputs: result.outputs,
        ...(result.retainedStage === undefined ? {} : { retainedStage: result.retainedStage }),
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const code = error instanceof ProductionBundleError ? error.code : "ARM64_SOURCE_BUILD_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 2;
}
