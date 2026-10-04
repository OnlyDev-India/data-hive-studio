import { describe, expect, it } from "vitest";
import {
  fieldOf,
  intOf,
  isDoc,
  isWrapper,
  lastSegment,
  literalOf,
  parseLiteral,
  splitList,
} from "../scalar";

const OID = "507f1f77bcf86cd799439011";

describe("parseLiteral", () => {
  it("reads whole numbers as longs and decimals as doubles", () => {
    expect(parseLiteral("10")).toEqual({
      ok: true,
      value: { $numberLong: "10" },
    });
    expect(parseLiteral(" -3 ")).toEqual({
      ok: true,
      value: { $numberLong: "-3" },
    });
    for (const t of ["1.5", ".5", "1e3", "2.5E-2"])
      expect(parseLiteral(t)).toEqual({
        ok: true,
        value: { $numberDouble: t },
      });
  });

  it("reads booleans and null as themselves", () => {
    expect(parseLiteral("true")).toEqual({ ok: true, value: true });
    expect(parseLiteral("false")).toEqual({ ok: true, value: false });
    expect(parseLiteral("null")).toEqual({ ok: true, value: null });
  });

  it("treats quoted, single quoted and bare text as the same string", () => {
    expect(parseLiteral('"A"')).toEqual({ ok: true, value: "A" });
    expect(parseLiteral("'A'")).toEqual({ ok: true, value: "A" });
    expect(parseLiteral("A")).toEqual({ ok: true, value: "A" });
    expect(parseLiteral('"a \\"b\\""')).toEqual({ ok: true, value: 'a "b"' });
  });

  it("refuses a double quoted string with a bad escape", () => {
    expect(parseLiteral('"bad \\x"')).toEqual({
      ok: false,
      error: "This string has a bad escape",
    });
  });

  it("reads an ObjectId in either quote style, lower cased", () => {
    expect(parseLiteral(`ObjectId("${OID.toUpperCase()}")`)).toEqual({
      ok: true,
      value: { $oid: OID },
    });
    expect(parseLiteral(`new ObjectId('${OID}')`)).toEqual({
      ok: true,
      value: { $oid: OID },
    });
  });

  it("refuses an ObjectId that is not 24 hex digits", () => {
    expect(parseLiteral('ObjectId("abc")')).toEqual({
      ok: false,
      error: "An ObjectId is 24 hex digits",
    });
  });

  it("reads ISODate and Date as a millisecond date", () => {
    const ms = Date.parse("2026-01-01T00:00:00Z");
    const want = { ok: true, value: { $date: { $numberLong: String(ms) } } };
    expect(parseLiteral('ISODate("2026-01-01T00:00:00Z")')).toEqual(want);
    expect(parseLiteral('new Date("2026-01-01T00:00:00Z")')).toEqual(want);
  });

  it("names the text of a date it cannot read", () => {
    expect(parseLiteral('ISODate("nope")')).toEqual({
      ok: false,
      error: '"nope" is not a date',
    });
  });

  it("reads the typed number constructors", () => {
    expect(parseLiteral('NumberDecimal("1.10")')).toEqual({
      ok: true,
      value: { $numberDecimal: "1.10" },
    });
    expect(parseLiteral("Decimal128('2')")).toEqual({
      ok: true,
      value: { $numberDecimal: "2" },
    });
    expect(parseLiteral("NumberLong(5)")).toEqual({
      ok: true,
      value: { $numberLong: "5" },
    });
    expect(parseLiteral('Long("-7")')).toEqual({
      ok: true,
      value: { $numberLong: "-7" },
    });
    expect(parseLiteral("NumberInt(7)")).toEqual({
      ok: true,
      value: { $numberInt: "7" },
    });
  });
});

describe("literalOf", () => {
  it("shows plain JSON scalars as their literals", () => {
    expect(literalOf(null)).toBe("null");
    expect(literalOf(true)).toBe("true");
    expect(literalOf("A")).toBe('"A"');
    expect(literalOf(3)).toBe("3");
  });

  it("shows typed numbers, keeping a whole double visibly a double", () => {
    expect(literalOf({ $numberInt: "5" })).toBe("5");
    expect(literalOf({ $numberLong: "-5" })).toBe("-5");
    expect(literalOf({ $numberDouble: "2" })).toBe("2.0");
    expect(literalOf({ $numberDouble: "2.5" })).toBe("2.5");
    expect(literalOf({ $numberDecimal: "1.10" })).toBe('NumberDecimal("1.10")');
  });

  it("shows ObjectIds and dates as shell constructors", () => {
    expect(literalOf({ $oid: OID })).toBe(`ObjectId("${OID}")`);
    expect(literalOf({ $date: { $numberLong: "0" } })).toBe(
      'ISODate("1970-01-01T00:00:00.000Z")',
    );
    expect(literalOf({ $date: "2026-01-01T00:00:00Z" })).toBe(
      'ISODate("2026-01-01T00:00:00.000Z")',
    );
  });

  it("is null for anything a value box cannot show", () => {
    expect(literalOf({ $date: "garbage" })).toBeNull();
    expect(literalOf({ a: 1 })).toBeNull();
    expect(literalOf([1])).toBeNull();
    expect(
      literalOf({ $regularExpression: { pattern: "a", options: "" } }),
    ).toBeNull();
    expect(literalOf(undefined)).toBeNull();
  });

  it.each([
    "10",
    "2.5",
    '"A"',
    "true",
    "null",
    `ObjectId("${OID}")`,
    'ISODate("2026-01-01T00:00:00.000Z")',
    'NumberDecimal("1.10")',
  ])("round trips %s through parseLiteral unchanged", (text) => {
    const parsed = parseLiteral(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(literalOf(parsed.value)).toBe(text);
  });
});

describe("intOf", () => {
  it("reads whole numbers from every integer form", () => {
    expect(intOf(true)).toBe(1);
    expect(intOf(false)).toBe(0);
    expect(intOf({ $numberInt: "3" })).toBe(3);
    expect(intOf({ $numberLong: "-4" })).toBe(-4);
    expect(intOf({ $numberDouble: "5" })).toBe(5);
    expect(intOf({ $numberDouble: "5.0" })).toBe(5);
  });

  it("is null for fractions and non numbers", () => {
    expect(intOf({ $numberDouble: "5.5" })).toBeNull();
    expect(intOf({ $numberLong: "x" })).toBeNull();
    expect(intOf("5")).toBeNull();
    expect(intOf(null)).toBeNull();
  });
});

describe("isWrapper and isDoc", () => {
  it("tell an Extended JSON scalar from a document", () => {
    expect(isWrapper({ $oid: OID })).toBe(true);
    expect(isWrapper({ $binary: { base64: "", subType: "00" } })).toBe(true);
    expect(isWrapper({ $date: { $numberLong: "0" } })).toBe(true);
    expect(isDoc({ $oid: OID })).toBe(false);
    expect(isDoc({ a: 1 })).toBe(true);
  });

  it("does not take operators, empty documents or arrays for wrappers", () => {
    expect(isWrapper({ $match: {} })).toBe(false);
    expect(isWrapper({})).toBe(false);
    expect(isWrapper({ $oid: OID, a: 1, b: 2 })).toBe(false);
    expect(isDoc({})).toBe(true);
    expect(isDoc([])).toBe(false);
    expect(isDoc(null)).toBe(false);
  });
});

describe("splitList", () => {
  it("splits on top level commas only", () => {
    expect(splitList('1, "a, b", 3')).toEqual(["1", '"a, b"', "3"]);
    expect(splitList(`ObjectId("${OID}"), [1, 2], 'x, y'`)).toEqual([
      `ObjectId("${OID}")`,
      "[1, 2]",
      "'x, y'",
    ]);
  });

  it("keeps an escaped quote inside its string", () => {
    expect(splitList('"a\\", b", c')).toEqual(['"a\\", b"', "c"]);
  });

  it("drops a trailing empty item and returns nothing for blank text", () => {
    expect(splitList("a, ")).toEqual(["a"]);
    expect(splitList("   ")).toEqual([]);
  });
});

describe("fieldOf and lastSegment", () => {
  it("reads a field reference, never a variable", () => {
    expect(fieldOf("$a.b")).toBe("a.b");
    expect(fieldOf("$$ROOT")).toBeNull();
    expect(fieldOf("$")).toBeNull();
    expect(fieldOf("a")).toBeNull();
    expect(fieldOf(5)).toBeNull();
  });

  it("takes the last segment of a dotted path", () => {
    expect(lastSegment("a.b.c")).toBe("c");
    expect(lastSegment("a")).toBe("a");
  });
});
