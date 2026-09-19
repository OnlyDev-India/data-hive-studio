import { describe, it, expect } from "vitest";
import { singleCollectionQuery } from "../mongo-editable";

describe("singleCollectionQuery", () => {
  it("accepts a bare find()", () => {
    expect(singleCollectionQuery("db.users.find({})")).toEqual({
      table: "users",
    });
  });

  it("accepts findOne()", () => {
    expect(singleCollectionQuery('db.users.findOne({ "_id": 1 })')).toEqual({
      table: "users",
    });
  });

  it("accepts find() chained with sort/limit/skip", () => {
    expect(
      singleCollectionQuery(
        "db.users.find({}).sort({ name: 1 }).limit(10).skip(5)",
      ),
    ).toEqual({ table: "users" });
  });

  it("rejects aggregate()", () => {
    expect(singleCollectionQuery("db.users.aggregate([])")).toBeNull();
  });

  it("rejects count()", () => {
    expect(singleCollectionQuery("db.users.count({})")).toBeNull();
  });

  it("rejects updateMany()", () => {
    expect(
      singleCollectionQuery("db.users.updateMany({}, { $set: { a: 1 } })"),
    ).toBeNull();
  });

  it("falls back to the SQL-on-Mongo detector for SQL-shaped input", () => {
    expect(singleCollectionQuery("SELECT * FROM users")).toEqual({
      table: "users",
    });
    expect(
      singleCollectionQuery(
        "SELECT * FROM users JOIN orders ON orders.user_id = users.id",
      ),
    ).toBeNull();
  });
});
