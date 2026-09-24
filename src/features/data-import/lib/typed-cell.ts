import type { Cell } from "./types";
import type { CellCheck } from "./validate-cell";

/** Is this kind of database a document store? */
export function isDocumentDb(db: string | undefined): boolean {
  return db === "mongodb" || db === "documentdb";
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A date or timestamp cell as the extended JSON date Rust reads, or a reason
 *  it is not a date. A date with no zone is read as UTC. */
function asDate(cell: Cell): CellCheck {
  const t = String(cell).trim();
  const iso = DATE_ONLY.test(t)
    ? `${t}T00:00:00Z`
    : /(Z|[+-]\d{2}:?\d{2})$/.test(t)
      ? t.replace(" ", "T")
      : `${t.replace(" ", "T")}Z`;
  if (Number.isNaN(Date.parse(iso))) {
    return { ok: false, message: `"${t}" is not a date` };
  }
  return { ok: true, value: { $date: iso } };
}

/** Give a cell its real type for a NEW collection (spec 0008, AC-19). The rows
 *  go to Rust as typed JSON: numbers, booleans and `{"$date": ...}`. An
 *  existing collection sends strings instead, and Rust converts them with the
 *  types the collection already uses. `dataType` is the name the new column
 *  was given in `typeName` for a document store. */
export function typedCell(cell: Cell, dataType: string): CellCheck {
  switch (dataType) {
    case "integer": {
      if (typeof cell === "number") return { ok: true, value: cell };
      const t = String(cell).trim();
      const n = Number(t);
      // Past 2^53 a JS number loses digits, so a big value goes as a string
      // the server reads as a 64 bit integer.
      return {
        ok: true,
        value: Number.isSafeInteger(n) ? n : { $numberLong: t },
      };
    }
    case "double":
      return {
        ok: true,
        value: typeof cell === "number" ? cell : Number(cell),
      };
    case "date":
      return typeof cell === "string"
        ? asDate(cell)
        : { ok: true, value: cell };
    case "object": {
      if (typeof cell !== "string") return { ok: true, value: cell };
      try {
        return { ok: true, value: JSON.parse(cell) as Cell };
      } catch {
        return { ok: true, value: cell };
      }
    }
    default:
      return { ok: true, value: cell };
  }
}
