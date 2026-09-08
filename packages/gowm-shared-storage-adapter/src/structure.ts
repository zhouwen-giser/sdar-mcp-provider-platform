// Read-only catalog queries adapted from GOWM; see contracts/gowm-shared-storage/current/UPSTREAM_LICENSE.
import type { PoolClient } from "pg";
export async function readConsumedStructure(c: PoolClient) {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL search_path=pg_catalog,public");
    const schemas = ["gowm_device", "gowm_task", "gowm_execution", "ugv_smpp"];
    const cols = await c.query(
      `SELECT n.nspname schema,t.relname name,a.attname column,format_type(a.atttypid,a.atttypmod) type,a.attnotnull required,pg_get_expr(d.adbin,d.adrelid) default_sql FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum WHERE n.nspname=ANY($1) AND a.attnum>0 AND NOT a.attisdropped AND t.relkind IN ('r','p','v') ORDER BY 1,2,a.attnum`,
      [schemas],
    );
    const constraints = await c.query(
      `SELECT n.nspname schema,t.relname name,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=ANY($1) ORDER BY 1,2,3`,
      [schemas],
    );
    const indexes = await c.query(
      `SELECT schemaname schema,tablename name,indexname, indexdef FROM pg_indexes WHERE schemaname=ANY($1) ORDER BY 1,2,3`,
      [schemas],
    );
    const functions = await c.query(
      `SELECT n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1) ORDER BY 1,2,3`,
      [schemas],
    );
    const views = await c.query(
      `SELECT schemaname schema,viewname name,definition FROM pg_views WHERE schemaname=ANY($1) ORDER BY 1,2`,
      [schemas],
    );
    const triggers = await c.query(
      `SELECT n.nspname schema,t.relname name,g.tgname,pg_get_triggerdef(g.oid) definition FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=ANY($1) AND NOT g.tgisinternal ORDER BY 1,2,3`,
      [schemas],
    );
    return {
      columns: cols.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
      functions: functions.rows,
      views: views.rows,
      triggers: triggers.rows,
    };
  } finally {
    await c.query("ROLLBACK");
  }
}
