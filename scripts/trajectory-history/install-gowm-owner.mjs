import { readFileSync, statSync } from "node:fs";
import { Pool } from "pg";
import {
  installGowmTrajectoryHistory,
  trajectoryHistoryMigration,
} from "../../deploy/gowm-trajectory-history/install.mjs";

const args = process.argv.slice(2);
const index = args.indexOf("--owner-url-file");
const file = args[index + 1];
if (index < 0 || !file)
  throw Error(
    "Usage: node scripts/trajectory-history/install-gowm-owner.mjs --owner-url-file /private/owner-url [--apply]",
  );
if ((statSync(file).mode & 0o077) !== 0) throw Error("HISTORY_OWNER_PRIVATE_URL_FILE_REQUIRED");
const pool = new Pool({ connectionString: readFileSync(file, "utf8").trim(), max: 1 });
const client = await pool.connect();
try {
  const result = await installGowmTrajectoryHistory(
    client,
    trajectoryHistoryMigration(),
    args.includes("--apply"),
  );
  process.stdout.write(
    JSON.stringify({
      mode: args.includes("--apply") ? "OWNER_APPLY" : "READ_ONLY_PREFLIGHT",
      ...result,
    }) + "\n",
  );
} finally {
  client.release();
  await pool.end();
}
