#!/usr/bin/env node

import { runProductPackagerCli } from "./package-product-lib.mjs";

await runProductPackagerCli("ugv", process.argv.slice(2));
