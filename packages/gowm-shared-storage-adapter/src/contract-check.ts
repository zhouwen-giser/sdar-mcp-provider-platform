import { requireValue } from "./value.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import type { GowmStorageConfig } from "./config.js";
import { readConsumedStructure } from "./structure.js";

type CatalogRow = Record<string, unknown>;
interface SourceContract {
  core: { file: string; sha256: string };
  entries: { family: string; file: string; generatedSha256: string }[];
  overlays: { family: string; file: string; sha256: string }[];
}
const mismatch = (detail: string): never => {
  throw new Error(`GOWM_STORAGE_CONTRACT_MISMATCH: ${detail}`);
};
const canonical = (row: CatalogRow) =>
  JSON.stringify(
    Object.keys(row)
      .sort()
      .map((key) => [key, row[key]]),
  );

/** Verification only: no installer, provisioning, DDL or SDAR connection. */
export async function verifyGowmStorage(
  pool: Pool,
  config: Pick<GowmStorageConfig, "contractDir">,
): Promise<void> {
  const source = JSON.parse(
    await readFile(join(config.contractDir, "source.json"), "utf8"),
  ) as SourceContract;
  const expected = JSON.parse(
    await readFile(join(config.contractDir, "consumed-schema.json"), "utf8"),
  ) as Record<string, CatalogRow[]>;
  const client = await pool.connect();
  try {
    const core = await client.query<{ checksum: string }>(
      "SELECT checksum FROM public.schema_migration WHERE version=$1",
      [source.core.file],
    );
    if (core.rows[0]?.checksum !== source.core.sha256) mismatch("core migration checksum");
    const history = await client.query<{ family: string; file: string; checksum: string }>(
      "SELECT family,file,checksum FROM ugv_smpp.gowm_install_history",
    );
    for (const entry of [
      ...source.entries.map((e) => ({ ...e, sha256: e.generatedSha256 })),
      ...source.overlays,
    ]) {
      if (
        !history.rows.some(
          (r) => r.family === entry.family && r.file === entry.file && r.checksum === entry.sha256,
        )
      )
        mismatch(`${entry.family}/${entry.file}`);
    }
    const actual = (await readConsumedStructure(client)) as Record<string, CatalogRow[]>;
    for (const [category, rows] of Object.entries(expected)) {
      const available = new Set((actual[category] ?? []).map(canonical));
      for (const row of rows) {
        // PG <18 represents NOT NULL in pg_attribute; columns already enforce it.
        if (category === "constraints" && String(row.definition).startsWith("NOT NULL ")) continue;
        if (!available.has(canonical(row)))
          mismatch(`${category}:${String(row.schema)}.${String(row.name)}`);
      }
    }
    const tables = [
      ...new Set(
        requireValue(expected.columns).map((row) => `${String(row.schema)}.${String(row.name)}`),
      ),
    ];
    const grants = await client.query<{ name: string; readable: boolean; writable: boolean }>(
      `SELECT name,has_table_privilege(name,'SELECT') readable,
        (has_table_privilege(name,'INSERT') AND has_table_privilege(name,'UPDATE')) writable FROM unnest($1::text[]) name`,
      [tables],
    );
    for (const row of grants.rows) {
      if (
        !row.readable ||
        ((row.name.startsWith("ugv_smpp.") ||
          row.name.startsWith("gowm_task.") ||
          row.name.startsWith("gowm_execution.")) &&
          !row.writable)
      )
        mismatch(`privileges:${row.name}`);
    }
  } finally {
    client.release();
  }
}
