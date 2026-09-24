import { describe, expect, it } from "vitest";
import { decodeText } from "../read-text";
import { parseCsvText } from "../parse-csv";
import { parseJsonLines, parseJsonText } from "../parse-json";
import { checkCell } from "../validate-cell";

describe("decodeText", () => {
  it("reads Windows-1252 accents and strips a UTF-8 byte order mark", () => {
    expect(
      decodeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]), "windows-1252"),
    ).toBe("café");
    expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]), "utf-8")).toBe(
      "a",
    );
  });
  it("reads UTF-16 of either byte order", () => {
    expect(
      decodeText(Uint8Array.from([0xff, 0xfe, 0x61, 0x00]), "utf-16"),
    ).toBe("a");
    expect(
      decodeText(Uint8Array.from([0xfe, 0xff, 0x00, 0x61]), "utf-16"),
    ).toBe("a");
  });
});

describe("parseCsvText", () => {
  it("detects the separator and keeps file row numbers across blank lines", () => {
    const t = parseCsvText("a;b\n1;2\n\n3;4\n", true);
    expect(t.header).toEqual(["a", "b"]);
    expect(t.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(t.sourceRows).toEqual([2, 4]);
  });
  it("names columns when there is no header row", () => {
    const t = parseCsvText("1,2\n3,4", false);
    expect(t.header).toEqual(["Column 1", "Column 2"]);
    expect(t.sourceRows).toEqual([1, 2]);
  });
});

describe("JSON", () => {
  it("reads an array, a single object and lines, keeping nested values", () => {
    const arr = parseJsonText('[{"a":1,"n":{"x":1}},{"b":2}]');
    expect(arr.header).toEqual(["a", "n", "b"]);
    expect(arr.rows[0]).toEqual([1, { x: 1 }, null]);
    expect(parseJsonText('{"a":1}').rows).toEqual([[1]]);
    const lines = parseJsonLines('{"a":1}\n\n{"a":2}');
    expect(lines.rows).toEqual([[1], [2]]);
    expect(lines.sourceRows).toEqual([1, 3]);
  });
  it("refuses rows that are not objects", () => {
    expect(() => parseJsonText("[1]")).toThrow(/Row 1/);
    expect(() => parseJsonLines('{"a":1}\nnope')).toThrow(/Line 2/);
  });
});

describe("checkCell", () => {
  it("accepts integers and decimals and refuses text", () => {
    expect(checkCell(" 12 ", "integer", "sqlite")).toEqual({
      ok: true,
      value: "12",
    });
    expect(checkCell("1.5", "integer", "sqlite").ok).toBe(false);
    expect(checkCell("1.5e3", "decimal", "postgres").ok).toBe(true);
    expect(checkCell({ a: 1 }, "decimal", "postgres").ok).toBe(false);
  });
});
