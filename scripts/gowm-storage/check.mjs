import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = "contracts/gowm-shared-storage/current/";
const source = JSON.parse(readFileSync(root + "source.json"));
const contract = JSON.parse(readFileSync(root + "consumed-schema.json"));
assert.equal(source.entries.length, 32);
assert.equal(new Set(source.entries.map((e) => e.family + "/" + e.file)).size, 32);
assert.equal(
  source.entries.filter((e) => e.family === "SMPP_RUNTIME" && e.file.startsWith("014")).length,
  2,
);
assert(
  contract.constraints.some(
    (r) =>
      r.schema === "ugv_smpp" &&
      r.name === "runtime_lease" &&
      r.definition === "PRIMARY KEY (scope_key, lease_key)",
  ),
);
assert(
  contract.columns.some(
    (r) => r.name === "ugv_execution" && r.column === "mcp_task_id" && !r.required,
  ),
);
assert(!source.entries.some((e) => e.schema !== "ugv_smpp"));
const runtime = readFileSync("apps/runtime/src/runtime.ts", "utf8");
assert(runtime.includes("verifyGowmStorage(pool, config.gowmStorage)"));
assert(runtime.includes("else await runMigrations(pool)"));
const ttl = readFileSync("packages/task-engine/src/ttl-cleaner.ts", "utf8");
assert(ttl.includes("purge_after <= $1 AND ${!scoped(client)}"));
console.log(
  "PASS: consumer contract, migration families, final lease identity, startup verify and history retention checks",
);
