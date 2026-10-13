import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { trajectoryHistorySchemas } from "../../packages/trajectory-history/src/contract.js";
import { format, resolveConfig } from "prettier";

const folder = "contracts/ugv-trajectory-history/v1";
mkdirSync(folder, { recursive: true });
const check = process.argv.includes("--check");
async function output(file, bytes) {
  if (file.endsWith(".json"))
    bytes = await format(bytes, { ...(await resolveConfig(file)), parser: "json" });
  if (check) {
    if (readFileSync(file, "utf8") !== bytes)
      throw Error("HISTORY_GENERATED_CONTRACT_DRIFT: " + file);
  } else writeFileSync(file, bytes);
}
const native = readFileSync(
  "migrations/providers/ugv/033_trajectory_reception_history.sql",
  "utf8",
);
const hosted =
  "-- Optional forward extension. Apply only through the GOWM owner installer.\nSET LOCAL search_path=ugv_smpp,public;\n" +
  native +
  readFileSync("deploy/gowm-trajectory-history/hosted-scope.sql", "utf8");
await output("deploy/gowm-trajectory-history/031_trajectory_reception_history.sql", hosted);
for (const [name, schema] of Object.entries(trajectoryHistorySchemas()))
  await output(`${folder}/${name}.schema.json`, JSON.stringify(schema, null, 2) + "\n");
await output(
  `${folder}/gowm-storage.json`,
  JSON.stringify(
    {
      schema: "gowm.trajectory-history-storage/v1",
      family: "UGV_PROVIDER",
      migrationFile: "031_trajectory_reception_history.sql",
      installedSha256: createHash("sha256").update(hosted).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
await output(
  `${folder}/native-storage.json`,
  JSON.stringify(
    {
      schema: "smpp.trajectory-history-storage/v1",
      family: "UGV_PROVIDER",
      migrationFile: "033_trajectory_reception_history.sql",
      installedSha256: createHash("sha256").update(native).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  check
    ? "PASS: trajectory history schemas and forward migration contracts"
    : "Generated trajectory history v1 contracts",
);
