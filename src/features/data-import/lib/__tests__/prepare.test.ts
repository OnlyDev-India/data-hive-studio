import { describe, expect, it } from "vitest";
import type { ColumnInfo, ImportReport } from "@/shared/api";
import { buildFailedCsv } from "../failed-csv";
import { mergeReport, makeContext, prepare } from "../prepare";
import type { ParsedFile } from "../types";

const col = (name: string, data_type = "TEXT"): ColumnInfo => ({
  name,
  data_type,
  not_null: false,
  primary_key: false,
  default: null,
});

const file = (rows: string[][], header = ["id", "name"]): ParsedFile => ({
  format: "csv",
  header,
  rows,
  sourceRows: rows.map((_, i) => i + 2),
});

const cols = [col("id", "INTEGER"), col("name")];
const map = { id: 0, name: 1 };

function run(
  parsed: ParsedFile,
  over: Partial<Parameters<typeof prepare>[0]> = {},
  emptyAsText = false,
) {
  const ctx = makeContext(parsed, map, cols, "sqlite", emptyAsText);
  return prepare({
    table: "t",
    parsed,
    ctx,
    onError: "rollback",
    dryRun: false,
    sourceLabel: "f.csv",
    ...over,
  });
}

describe("prepare", () => {
  it("turns empty cells into NULL, or an empty string in text columns on request", () => {
    const parsed = file([["1", ""]]);
    expect(run(parsed).request?.data).toMatchObject({ rows: [["1", null]] });
    expect(run(parsed, {}, true).request?.data).toMatchObject({
      rows: [["1", ""]],
    });
  });

  it("keeps a JSON null as NULL, never an empty string", () => {
    const parsed: ParsedFile = {
      format: "json",
      header: ["id", "name"],
      rows: [[1, null]],
      sourceRows: [1],
    };
    expect(run(parsed, {}, true).request?.data).toMatchObject({
      rows: [[1, null]],
    });
  });

  it("pads a short row and fails a long one", () => {
    const parsed = file([["1"], ["2", "b", "extra"]]);
    const p = run(parsed, { onError: "skip" });
    expect(p.request?.data).toMatchObject({ rows: [["1", null]] });
    expect(p.failures).toEqual([
      expect.objectContaining({ sourceRow: 3, column: null }),
    ]);
  });

  it("fails a cell that is not a whole number and never sends that row", () => {
    const p = run(
      file([
        ["abc", "x"],
        ["2", "y"],
      ]),
      { onError: "skip" },
    );
    expect(p.failures[0]).toMatchObject({ sourceRow: 2, column: "id" });
    expect(p.failures[0].message).toContain("whole number");
    expect(p.sent).toEqual([1]);
    expect(p.request?.dry_run).toBe(false);
  });

  it("checks instead of committing in Roll back mode when a row already failed", () => {
    const p = run(
      file([
        ["abc", "x"],
        ["2", "y"],
      ]),
    );
    expect(p.request?.dry_run).toBe(true);
  });

  it("sends nothing when every row failed", () => {
    expect(run(file([["abc", "x"]]), { onError: "skip" }).request).toBeNull();
  });

  it("sends booleans as 1 or 0 on SQLite and true or false elsewhere", () => {
    const parsed = file([["yes"]], ["b"]);
    const bcols = [col("b", "BOOLEAN")];
    for (const [db, want] of [
      ["sqlite", 1],
      ["postgres", true],
    ] as const) {
      const ctx = makeContext(parsed, { b: 0 }, bcols, db, false);
      const p = prepare({
        table: "t",
        parsed,
        ctx,
        onError: "skip",
        dryRun: false,
        sourceLabel: "f",
      });
      expect(p.request?.data).toMatchObject({ rows: [[want]] });
    }
  });
});

describe("mergeReport", () => {
  it("points a database failure at the file row it came from", () => {
    const parsed = file([
      ["abc", "x"],
      ["2", "y"],
      ["3", "z"],
    ]);
    const prep = run(parsed, { onError: "skip" });
    const report: ImportReport = {
      inserted: 1,
      failed: [{ index: 1, column: "id", message: "UNIQUE constraint failed" }],
      failed_total: 1,
      failed_truncated: false,
      committed: true,
      atomic: true,
      cancelled: false,
      dry_run: false,
      statements: [],
    };
    const out = mergeReport(prep, parsed, report);
    expect(out.failures.map((f) => f.sourceRow)).toEqual([2, 4]);
    expect(out.failedTotal).toBe(2);
    expect(out.inserted).toBe(1);
  });
});

describe("buildFailedCsv", () => {
  it("writes the failed rows with a reason column", () => {
    const parsed = file([["abc", "x, y"]]);
    const csv = buildFailedCsv(parsed, [
      { rowIndex: 0, sourceRow: 2, column: "id", message: "bad" },
    ]);
    expect(csv).toBe('id,name,reason\r\nabc,"x, y",id: bad');
  });
});
