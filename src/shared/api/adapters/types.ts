import type { DbKind } from "../types";

/** A ready-to-run statement: SQL text plus its bound `?` parameters. */
export interface BuiltQuery {
  sql: string;
  params: (string | null)[];
}

/** A WHERE condition WITHOUT the leading `WHERE` keyword, plus bound params.
 * The adapter splices it into the statement with dialect-appropriate syntax. */
export interface WhereClause {
  sql: string;
  params: (string | null)[];
}

/** Structured description of one statement. The UI never writes SQL itself —
 * it describes WHAT it wants and the adapter decides HOW to say it. */
export type QueryDetails =
  | {
      kind: "select";
      table: string;
      where?: WhereClause;
      order_by?: string;
      order_dir?: "ASC" | "DESC";
      limit?: number;
      offset?: number;
    }
  | { kind: "count"; table: string; where?: WhereClause }
  | { kind: "select_distinct"; table: string; column: string; limit?: number }
  /** Parameterized INSERT. With `skip_empty`, columns whose value is null/''
   * are left out so the database applies defaults/autoincrement; if no columns
   * remain, a DEFAULT VALUES insert is produced instead. */
  | {
      kind: "insert";
      table: string;
      values: Record<string, string | null>;
      skip_empty?: boolean;
    }
  | {
      kind: "update";
      table: string;
      set: Record<string, string | null>;
      where: WhereClause;
    }
  | { kind: "delete"; table: string; where: WhereClause }
  /** INSERT with inline literals (no bound params) for copy/export features. */
  | {
      kind: "insert_literal";
      table: string;
      columns: string[];
      values: (string | null)[];
      types?: Record<string, string>;
    }
  | { kind: "drop_table"; table: string };

/** Per-dialect query builder. One implementation per database kind; adding a
 * new backend means adding an adapter, not touching UI code. */
export interface SqlAdapter {
  readonly kind: DbKind;
  /** Quote a table/column identifier for this dialect. */
  quoteIdent(name: string): string;
  /** The single entry point: structured details in, runnable SQL out. */
  buildQuery(details: QueryDetails): BuiltQuery;
}
