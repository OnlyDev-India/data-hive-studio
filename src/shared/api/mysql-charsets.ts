import { runSql } from "./query";

/** The charsets and collations a MySQL server offers, and the defaults a
 *  new database or table starts from (spec 0025 AC-18, AC-20). */
export interface MysqlCharsets {
  charsets: { name: string; default_collation: string }[];
  collations: { name: string; charset: string }[];
  /** The target database's own (`information_schema.SCHEMATA`), or the
   *  server's when no database is given. */
  default_charset: string;
  default_collation: string;
  /** The engine a new table gets (`@@default_storage_engine`). */
  default_engine: string;
}

const lit = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

/** Read the lists in three small catalog queries. `database` picks whose
 *  defaults come back; omitted = the server's. */
export async function mysqlCharsets(
  connId: string,
  database?: string,
): Promise<MysqlCharsets> {
  const defaults_sql = database
    ? `SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME, @@default_storage_engine FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${lit(database)}`
    : "SELECT @@character_set_server, @@collation_server, @@default_storage_engine";
  const [sets, colls, defs] = await Promise.all([
    runSql(
      connId,
      "SELECT CHARACTER_SET_NAME, DEFAULT_COLLATE_NAME FROM information_schema.CHARACTER_SETS ORDER BY 1",
    ),
    // MariaDB lists some collations with no charset; they can't be picked.
    runSql(
      connId,
      "SELECT COLLATION_NAME, CHARACTER_SET_NAME FROM information_schema.COLLATIONS WHERE CHARACTER_SET_NAME IS NOT NULL ORDER BY 1",
    ),
    runSql(connId, defaults_sql),
  ]);
  return {
    charsets: sets.rows.map((r) => ({
      name: r[0] ?? "",
      default_collation: r[1] ?? "",
    })),
    collations: colls.rows.map((r) => ({
      name: r[0] ?? "",
      charset: r[1] ?? "",
    })),
    default_charset: defs.rows[0]?.[0] ?? "",
    default_collation: defs.rows[0]?.[1] ?? "",
    default_engine: defs.rows[0]?.[2] ?? "",
  };
}
