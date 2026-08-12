#!/usr/bin/env node

import { runProductPackagerCli } from "./package-product-lib.mjs";

await runProductPackagerCli("npc-tank", process.argv.slice(2));
