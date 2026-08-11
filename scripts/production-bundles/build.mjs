#!/usr/bin/env node

import { buildProductionBundles, parseBuilderArguments, ProductionBundleError } from "./lib.mjs";

try {
  const options = parseBuilderArguments(process.argv.slice(2));
  const result = await buildProductionBundles(options);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.stageOnly ? "STAGE_ONLY_PASS" : "PRODUCTION_BUNDLES_BUILT",
        sourceRevision: result.source.revision,
        stageOnly: result.stageOnly,
        outputs: result.outputs,
        ...(result.retainedStage === undefined ? {} : { retainedStage: result.retainedStage }),
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const code =
    error instanceof ProductionBundleError ? error.code : "PRODUCTION_BUNDLE_BUILD_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 2;
}
