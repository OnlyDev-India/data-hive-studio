import { describe, it, expect } from "vitest";
import { wordAt } from "./doc-hover";
import { resolveSqlDoc } from "./sql-docs";
import { resolveMongoDoc } from "./nosql-docs";

describe("wordAt", () => {
  it("returns the word containing pos", () => {
    const doc = "SELECT * FROM users";
    const w = wordAt(doc, 3);
    expect(w).toEqual({ text: "SELECT", from: 0, to: 6 });
  });

  it("returns null between words", () => {
    expect(wordAt("SELECT * FROM users", 7)).toBeNull();
  });

  it("finds the word immediately before pos, at its boundary", () => {
    const doc = "db.users.find()";
    // pos right after "find", before "("
    const w = wordAt(doc, 13);
    expect(w?.text).toBe("find");
  });
});

describe("resolveSqlDoc", () => {
  it("resolves a hover over a known keyword", () => {
    const doc = "SELECT * FROM users;";
    const hit = resolveSqlDoc(doc, 2);
    expect(hit?.entry.name).toBe("SELECT");
  });

  it("is case-insensitive", () => {
    const doc = "select * from users;";
    expect(resolveSqlDoc(doc, 2)?.entry.name).toBe("SELECT");
  });

  it("resolves a known function", () => {
    const doc = "SELECT COUNT(*) FROM orders;";
    const hit = resolveSqlDoc(doc, 8);
    expect(hit?.entry.name).toBe("COUNT()");
  });

  it("returns null for an unrecognized word (e.g. a table name)", () => {
    const doc = "SELECT * FROM users;";
    expect(resolveSqlDoc(doc, 16)).toBeNull();
  });

  it("does not resolve a keyword mentioned inside a -- comment", () => {
    const doc = "-- SELECT * FROM users\nDELETE FROM sessions;";
    expect(resolveSqlDoc(doc, 4)).toBeNull();
  });
});

describe("resolveMongoDoc", () => {
  it("resolves a method right after a dot", () => {
    const doc = "db.users.find({})";
    const hit = resolveMongoDoc(doc, 10);
    expect(hit?.entry.name).toBe("find()");
  });

  it("resolves a chained method after find()", () => {
    const doc = "db.users.find({}).limit(10)";
    const hit = resolveMongoDoc(doc, 20);
    expect(hit?.entry.name).toBe(".limit()");
  });

  it("does not resolve a bare word that isn't a method call", () => {
    // "find" typed as a JSON field name, not `.find(`.
    const doc = '{ "find": true }';
    expect(resolveMongoDoc(doc, 4)).toBeNull();
  });

  it("resolves the `use` shell keyword at the start of a line", () => {
    const doc = "use analytics";
    expect(resolveMongoDoc(doc, 1)?.entry.name).toBe("use");
  });

  it("does not resolve `use` when it isn't the first word on its line", () => {
    const doc = "db.users.find({ use: 1 })";
    expect(resolveMongoDoc(doc, doc.indexOf("use") + 1)).toBeNull();
  });

  it("resolves a $operator anywhere, not just after a dot", () => {
    const doc = "db.users.find({ $and: [{ age: { $gt: 18 } }] })";
    expect(resolveMongoDoc(doc, doc.indexOf("$and") + 2)?.entry.name).toBe(
      "$and",
    );
    expect(resolveMongoDoc(doc, doc.indexOf("$gt") + 2)?.entry.name).toBe(
      "$gt",
    );
  });

  it("resolves $set as a doc covering both its update and aggregation meanings", () => {
    const doc = 'db.orders.updateOne({}, { $set: { status: "shipped" } })';
    expect(resolveMongoDoc(doc, doc.indexOf("$set") + 2)?.entry.name).toBe(
      "$set",
    );
  });

  it("does not resolve a method mentioned inside a // comment", () => {
    const doc = "// db.users.find({})\ndb.users.insertOne({})";
    expect(resolveMongoDoc(doc, 12)).toBeNull();
  });
});
