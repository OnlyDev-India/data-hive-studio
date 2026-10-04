import { describe, expect, it } from "vitest";
import { decodeForm, encodeForm, type FormModel } from "../forms";
import { literalOf, parseLiteral, splitList } from "../scalar";

const roundTrip = (op: string, v: unknown) => {
  const m = decodeForm(op, v);
  expect(m).not.toBeNull();
  const out = encodeForm(m as FormModel);
  expect(out).toEqual({ ok: true, value: v });
};

describe("scalar literals", () => {
  it("reads what a value box holds as canonical Extended JSON", () => {
    expect(parseLiteral("10")).toEqual({
      ok: true,
      value: { $numberLong: "10" },
    });
    expect(parseLiteral("1.5")).toEqual({
      ok: true,
      value: { $numberDouble: "1.5" },
    });
    expect(parseLiteral('"10"')).toEqual({ ok: true, value: "10" });
    expect(parseLiteral("A")).toEqual({ ok: true, value: "A" });
    expect(parseLiteral('ObjectId("507F1F77BCF86CD799439011")')).toEqual({
      ok: true,
      value: { $oid: "507f1f77bcf86cd799439011" },
    });
    expect(parseLiteral('ObjectId("nope")').ok).toBe(false);
    expect(parseLiteral('ISODate("2024-01-02T00:00:00Z")')).toEqual({
      ok: true,
      value: { $date: { $numberLong: "1704153600000" } },
    });
  });

  it("shows a value back as the literal that reads the same", () => {
    for (const t of ["10", "1.5", '"A"', "true", "null"])
      expect(literalOf((parseLiteral(t) as { value: unknown }).value)).toBe(t);
    expect(literalOf({ $numberDouble: "2" })).toBe("2.0");
    expect(literalOf({ a: 1 })).toBeNull();
  });

  it("splits a list on commas outside quotes", () => {
    expect(splitList('1, "a, b", ObjectId("x")')).toEqual([
      "1",
      '"a, b"',
      'ObjectId("x")',
    ]);
  });
});

describe("stage forms", () => {
  it("round trip every form the decoder accepts", () => {
    roundTrip("$match", {
      status: "A",
      n: { $gt: { $numberLong: "5" }, $lte: { $numberLong: "9" } },
      tag: { $in: ["x", { $numberLong: "2" }] },
      gone: { $exists: false },
    });
    roundTrip("$project", {
      name: { $numberLong: "1" },
      _id: { $numberLong: "0" },
      total: "$amount",
    });
    roundTrip("$sort", { n: { $numberLong: "-1" }, a: { $numberLong: "1" } });
    roundTrip("$limit", { $numberLong: "10" });
    roundTrip("$group", {
      _id: "$customer",
      total: { $sum: "$amount" },
      n: { $sum: { $numberLong: "1" } },
      c: { $count: {} },
    });
    roundTrip("$group", { _id: { a: "$a", b: "$b.c" } });
    roundTrip("$lookup", {
      from: "users",
      localField: "user_id",
      foreignField: "_id",
      as: "user",
    });
    roundTrip("$unwind", "$items");
    roundTrip("$unwind", {
      path: "$items",
      includeArrayIndex: "i",
      preserveNullAndEmptyArrays: true,
    });
  });

  it("leave a value the form cannot show to JSON", () => {
    expect(decodeForm("$match", { $or: [{ a: 1 }] })).toBeNull();
    expect(decodeForm("$match", { a: { $elemMatch: { b: 1 } } })).toBeNull();
    expect(decodeForm("$project", { a: { $concat: ["$b"] } })).toBeNull();
    expect(decodeForm("$sort", { score: { $meta: "textScore" } })).toBeNull();
    expect(
      decodeForm("$lookup", { from: "u", pipeline: [], as: "x" }),
    ).toBeNull();
    expect(decodeForm("$addFields", {})).toBeNull();
  });

  it("an equals row on a field with other conditions becomes $eq", () => {
    const out = encodeForm({
      op: "$match",
      rows: [
        { field: "a", op: "=", value: "1" },
        { field: "a", op: "$ne", value: "2" },
        { field: "", op: "=", value: "skipped" },
      ],
    });
    expect(out).toEqual({
      ok: true,
      value: { a: { $eq: { $numberLong: "1" }, $ne: { $numberLong: "2" } } },
    });
  });

  it("a bad number or literal is an error, not a write", () => {
    expect(encodeForm({ op: "$limit", n: "ten" }).ok).toBe(false);
    expect(
      encodeForm({
        op: "$match",
        rows: [{ field: "d", op: "$gt", value: 'ISODate("never")' }],
      }).ok,
    ).toBe(false);
  });
  it("a $lookup form leaves out empty join fields", () => {
    const m = decodeForm("$lookup", { from: "u", as: "x" });
    expect(m).not.toBeNull();
    expect(encodeForm(m!)).toEqual({ ok: true, value: { from: "u", as: "x" } });
  });
});
