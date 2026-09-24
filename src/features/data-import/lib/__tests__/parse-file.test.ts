import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { formatOf, parseFile } from "../parse-file";
import { MAX_DATA_ROWS, MAX_FILE_BYTES, formatBytes } from "../limits";
import type { ParseOptions } from "../types";

const opts: ParseOptions = { encoding: "utf-8", hasHeader: true };

function textFile(name: string, text: string): File {
  return new File([text], name);
}

function workbook(sheets: Record<string, unknown[][]>): File {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([bytes], "book.xlsx");
}

describe("formatOf", () => {
  it("reads the format from the file extension, case blind", () => {
    expect(formatOf("a.JSON")).toBe("json");
    expect(formatOf("a.jsonl")).toBe("jsonl");
    expect(formatOf("a.ndjson")).toBe("jsonl");
    expect(formatOf("a.xlsx")).toBe("xlsx");
  });

  it("reads anything else as CSV", () => {
    expect(formatOf("a.csv")).toBe("csv");
    expect(formatOf("a.txt")).toBe("csv");
    expect(formatOf("noextension")).toBe("csv");
  });
});

describe("formatBytes", () => {
  it("picks a readable unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(MAX_FILE_BYTES)).toBe("100.0 MB");
  });
});

describe("parseFile", () => {
  it("parses a CSV with the header and file row numbers (AC-2)", async () => {
    const f = await parseFile(textFile("t.csv", "id,name\n1,a\n2,b\n"), opts);
    expect(f.format).toBe("csv");
    expect(f.header).toEqual(["id", "name"]);
    expect(f.rows).toEqual([
      ["1", "a"],
      ["2", "b"],
    ]);
    expect(f.sourceRows).toEqual([2, 3]);
  });

  it("parses a JSON array and JSON Lines by extension (AC-2)", async () => {
    const json = await parseFile(
      textFile("t.json", '[{"id":1},{"id":2}]'),
      opts,
    );
    expect(json.format).toBe("json");
    expect(json.rows).toHaveLength(2);
    const lines = await parseFile(
      textFile("t.jsonl", '{"id":1}\n{"id":2}\n{"id":3}\n'),
      opts,
    );
    expect(lines.format).toBe("jsonl");
    expect(lines.rows).toHaveLength(3);
  });

  it("decodes with the chosen encoding (AC-2)", async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode("name\n"),
      0x63, 0x61, 0x66, 0xe9,
    ]);
    const f = await parseFile(new File([bytes], "t.csv"), {
      ...opts,
      encoding: "windows-1252",
    });
    expect(f.rows).toEqual([["café"]]);
  });

  it("reads the first sheet of a workbook and lists every sheet (AC-2)", async () => {
    const f = await parseFile(
      workbook({
        People: [
          ["id", "name"],
          [1, "a"],
        ],
        Other: [["x"], [9]],
      }),
      opts,
    );
    expect(f.format).toBe("xlsx");
    expect(f.sheets).toEqual(["People", "Other"]);
    expect(f.sheet).toBe("People");
    expect(f.header).toEqual(["id", "name"]);
    expect(f.rows).toEqual([[1, "a"]]);
  });

  it("reads the sheet the person picked, and falls back when it is unknown", async () => {
    const file = workbook({ A: [["a"], [1]], B: [["b"], [2]] });
    const picked = await parseFile(file, { ...opts, sheet: "B" });
    expect(picked.sheet).toBe("B");
    expect(picked.header).toEqual(["b"]);
    const unknown = await parseFile(file, { ...opts, sheet: "Nope" });
    expect(unknown.sheet).toBe("A");
  });

  it("refuses a file over the size limit before reading it (AC-13)", async () => {
    const big = { name: "big.csv", size: MAX_FILE_BYTES + 1 } as File;
    await expect(parseFile(big, opts)).rejects.toThrow(/up to 100\.0 MB/);
  });

  it("refuses a file with too many data rows (AC-13)", async () => {
    const lines = ["id"];
    for (let i = 0; i <= MAX_DATA_ROWS; i++) lines.push(String(i));
    await expect(
      parseFile(textFile("many.csv", lines.join("\n")), opts),
    ).rejects.toThrow(/200,000/);
  });

  it("accepts a file with exactly the row limit (AC-13)", async () => {
    const lines = ["id"];
    for (let i = 0; i < MAX_DATA_ROWS; i++) lines.push(String(i));
    const f = await parseFile(textFile("edge.csv", lines.join("\n")), opts);
    expect(f.rows).toHaveLength(MAX_DATA_ROWS);
  });
});
