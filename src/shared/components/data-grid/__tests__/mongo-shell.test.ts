import { describe, expect, it } from "vitest";
import {
  mongo_delete,
  mongo_filter,
  mongo_insert,
  mongo_update,
  mongo_value,
} from "../mongo-shell";

const OID = "507f1f77bcf86cd799439011";

describe("mongo_value", () => {
  it("types values by column type, like Apply", () => {
    expect(mongo_value("42", "int")).toBe('{ "$numberLong": "42" }');
    expect(mongo_value("2.5", "double")).toBe("2.5");
    expect(mongo_value("3", "double")).toBe("3.0");
    expect(mongo_value("1", "bool")).toBe("true");
    expect(mongo_value("no", "bool")).toBe("false");
    expect(mongo_value('{"a":1}', "object")).toBe('{"a":1}');
    expect(mongo_value("2026-01-01T00:00:00Z", "date")).toBe(
      '{ "$date": "2026-01-01T00:00:00.000Z" }',
    );
    expect(mongo_value("hi", "string")).toBe('"hi"');
    expect(mongo_value(null, "string")).toBe("null");
  });

  it("guesses without a type hint, keeping ObjectId hex as a string", () => {
    expect(mongo_value("true")).toBe("true");
    expect(mongo_value("0")).toBe("false");
    expect(mongo_value("7")).toBe('{ "$numberLong": "7" }');
    expect(mongo_value("1.5")).toBe("1.5");
    expect(mongo_value("[1,2]")).toBe("[1,2]");
    expect(mongo_value('a "q"')).toBe('"a \\"q\\""');
    expect(mongo_value(OID)).toBe(`"${OID}"`);
  });
});

describe("mongo shell statements", () => {
  it("matches _id as an ObjectId", () => {
    expect(mongo_filter({ _id: OID })).toBe(`{ "_id": { "$oid": "${OID}" } }`);
  });

  it("builds insert, update and delete for the console", () => {
    expect(mongo_insert("users", { _id: null, name: "ann", age: "" }, {})).toBe(
      'db.users.insertOne({ "name": "ann" });',
    );
    expect(
      mongo_update("users", { _id: OID }, "age", "30", { age: "int" }),
    ).toBe(
      `db.users.updateMany({ "_id": { "$oid": "${OID}" } }, { "$set": { "age": { "$numberLong": "30" } } });`,
    );
    expect(mongo_update("users", { _id: OID }, "_id", "x", {})).toBeNull();
    expect(mongo_delete("users", { _id: OID })).toBe(
      `db.users.deleteMany({ "_id": { "$oid": "${OID}" } });`,
    );
  });
});
