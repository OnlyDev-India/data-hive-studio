import { describe, expect, it, vi } from "vitest";
import { extOf, fitsInt32, valueText, type Syntax } from "../values";

describe("extOf", () => {
  it("reads each typed wrapper", () => {
    expect(extOf({ $oid: "ab" })).toEqual({ t: "oid", hex: "ab" });
    expect(extOf({ $numberLong: "5" })).toEqual({ t: "long", n: "5" });
    expect(extOf({ $numberInt: "5" })).toEqual({ t: "int", n: "5" });
    expect(extOf({ $numberDouble: "1.5" })).toEqual({ t: "double", n: "1.5" });
    expect(extOf({ $numberDecimal: "1.10" })).toEqual({
      t: "decimal",
      n: "1.10",
    });
    expect(
      extOf({ $regularExpression: { pattern: "^a", options: "i" } }),
    ).toEqual({ t: "regex", pattern: "^a", options: "i" });
    expect(extOf({ $binary: { base64: "AA==", subType: "80" } })).toEqual({
      t: "binary",
      base64: "AA==",
      subType: 128,
    });
    expect(extOf({ $timestamp: { t: 10, i: 2 } })).toEqual({
      t: "timestamp",
      time: 10,
      inc: 2,
    });
    expect(extOf({ $minKey: 1 })).toEqual({ t: "minKey" });
    expect(extOf({ $maxKey: 1 })).toEqual({ t: "maxKey" });
  });

  it("reads a date in all three canonical forms", () => {
    const ms = Date.parse("2026-01-01T00:00:00Z");
    expect(extOf({ $date: "2026-01-01T00:00:00Z" })).toEqual({ t: "date", ms });
    expect(extOf({ $date: ms })).toEqual({ t: "date", ms });
    expect(extOf({ $date: { $numberLong: String(ms) } })).toEqual({
      t: "date",
      ms,
    });
  });

  it("is null for plain values and for documents that only start like a wrapper", () => {
    expect(extOf({ a: 1 })).toBeNull();
    expect(extOf({ $oid: "ab", extra: 1 })).toBeNull();
    expect(extOf({ $oid: 5 })).toBeNull();
    expect(extOf([{ $oid: "ab" }])).toBeNull();
    expect(extOf("x")).toBeNull();
    expect(extOf(null)).toBeNull();
  });
});

describe("fitsInt32", () => {
  it("accepts the 32 bit range and nothing past it", () => {
    expect(fitsInt32("2147483647")).toBe(true);
    expect(fitsInt32("-2147483648")).toBe(true);
    expect(fitsInt32("2147483648")).toBe(false);
    expect(fitsInt32("-2147483649")).toBe(false);
  });

  it("refuses fractions and text", () => {
    expect(fitsInt32("1.5")).toBe(false);
    expect(fitsInt32("abc")).toBe(false);
  });
});

describe("valueText", () => {
  const js: Syntax = {
    indent: "  ",
    key: (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)),
    literal: { null: "null", true: "true", false: "false" },
    ext: (e, need) => {
      need(e.t);
      return `<${e.t}>`;
    },
  };
  const text = (v: unknown, depth = 0) => valueText(v, depth, js, () => {});

  it("writes scalars with the language's literals", () => {
    expect(text(null)).toBe("null");
    expect(text(undefined)).toBe("null");
    expect(text(true)).toBe("true");
    expect(text('a"b')).toBe('"a\\"b"');
    expect(text(1.5)).toBe("1.5");
  });

  it("keeps short values on one line", () => {
    expect(text({ a: 1, "b c": [1, 2] })).toBe('{ a: 1, "b c": [1, 2] }');
    expect(text({})).toBe("{}");
    expect(text([])).toBe("[]");
  });

  it("breaks a long value onto indented lines", () => {
    const v = { first: "x".repeat(40), second: "y".repeat(40) };
    expect(text(v, 1)).toBe(
      `{\n    first: "${"x".repeat(40)}",\n    second: "${"y".repeat(40)}"\n  }`,
    );
  });

  it("hands typed values to the language and records what they need", () => {
    const need = vi.fn();
    expect(valueText({ at: { $oid: "ab" } }, 0, js, need)).toBe(
      "{ at: <oid> }",
    );
    expect(need).toHaveBeenCalledWith("oid");
  });
});
