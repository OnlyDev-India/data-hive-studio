import { parse as parseSql } from "sql-parser-cst";
import { parseable } from "./forms/cst";
import { quoteIdent, type Dialect, type TableRef } from "./sql-text";

export interface Built {
  text: string;
  /** Each card's character range in `text`. */
  ranges: { id: string; from: number; to: number }[];
}

/** Text built piece by piece, remembering where each card's part sits. */
export class Builder {
  text = "";
  ranges: Built["ranges"] = [];
  add(piece: string, id?: string) {
    const from = this.text.length;
    this.text += piece;
    if (id) this.ranges.push({ id, from, to: this.text.length });
  }
  done(): Built {
    return { text: this.text, ranges: this.ranges };
  }
}

/** The parser's first line, and which card its position falls in (else
 *  `fallback`, the last card in the query). */
export function parseError(
  built: Built,
  dialect: Dialect,
  fallback: string,
): { id: string; message: string } | null {
  try {
    parseSql(...parseable(built.text, dialect));
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const offset = errorOffset(built.text, message);
    const hit =
      offset === null
        ? undefined
        : (built.ranges.find((r) => offset >= r.from && offset < r.to) ??
          built.ranges.find((r) => offset === r.to));
    return { id: hit?.id ?? fallback, message: message.split("\n")[0] };
  }
}

/** The offset a `sql-parser-cst` message points at ("--> undefined:1:17"). */
function errorOffset(text: string, message: string): number | null {
  const m = /-->\s*\S*?:(\d+):(\d+)/.exec(message);
  if (!m) return null;
  const line = Number(m[1]);
  const column = Number(m[2]);
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++)
    offset += lines[i].length + 1;
  return offset + column - 1;
}

/** Qualify a bare table with `schema` (Postgres output). */
export function qualified(
  t: TableRef,
  schema: string | null,
  dialect: Dialect,
) {
  if (t.schema || !schema || dialect !== "postgresql") return t;
  return { ...t, schema: quoteIdent(schema, dialect) };
}
