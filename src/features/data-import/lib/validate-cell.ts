import type { ColumnInfo, DbKind } from "@/shared/api";
import type { Cell } from "./types";

export type ColumnKind = "integer" | "decimal" | "boolean" | "text" | "other";

/** What a column holds, from its declared type. Only integer, decimal and
 *  boolean are checked before sending (spec 0008, AC-5). An array column is
 *  left to the database. */
export function columnKind(c: ColumnInfo): ColumnKind {
  if (c.is_array) return "other";
  const t = c.data_type.toLowerCase().trim();
  if (/^bool/.test(t)) return "boolean";
  if (/^(tiny|small|medium|big)?(int|integer|serial)\d*\b/.test(t))
    return "integer";
  if (/^(numeric|decimal|real|float\d*|double|number)\b/.test(t)) {
    return "decimal";
  }
  if (/(char|text|clob|string|citext)/.test(t)) return "text";
  return "other";
}

const TRUE = new Set(["true", "t", "1", "yes", "y"]);
const FALSE = new Set(["false", "f", "0", "no", "n"]);
const INTEGER = /^[+-]?\d+$/;
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export type CellCheck =
  { ok: true; value: Cell } | { ok: false; message: string };

function shown(cell: Cell): string {
  const s = typeof cell === "object" ? JSON.stringify(cell) : String(cell);
  return `"${s.length > 40 ? `${s.slice(0, 40)}…` : s}"`;
}

/** Check one non-empty cell against its column and give back the value to send.
 *  A boolean goes as `1`/`0` on SQLite and `true`/`false` elsewhere. */
export function checkCell(
  cell: Cell,
  kind: ColumnKind,
  db: DbKind | undefined,
): CellCheck {
  if (kind === "integer" || kind === "decimal") {
    const whole = kind === "integer";
    if (typeof cell === "number") {
      const ok = whole ? Number.isInteger(cell) : Number.isFinite(cell);
      if (ok) return { ok: true, value: cell };
    } else if (typeof cell === "string") {
      const t = cell.trim();
      if ((whole ? INTEGER : DECIMAL).test(t)) return { ok: true, value: t };
    }
    return {
      ok: false,
      message: `${shown(cell)} is not a ${whole ? "whole number" : "number"}`,
    };
  }
  if (kind === "boolean") {
    let b: boolean | null = null;
    if (typeof cell === "boolean") b = cell;
    else if (typeof cell === "number")
      b = cell === 1 ? true : cell === 0 ? false : null;
    else if (typeof cell === "string") {
      const t = cell.trim().toLowerCase();
      b = TRUE.has(t) ? true : FALSE.has(t) ? false : null;
    }
    if (b === null) {
      return { ok: false, message: `${shown(cell)} is not true or false` };
    }
    return { ok: true, value: db === "sqlite" ? (b ? 1 : 0) : b };
  }
  return { ok: true, value: cell };
}
