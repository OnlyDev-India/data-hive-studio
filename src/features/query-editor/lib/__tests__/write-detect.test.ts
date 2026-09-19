import { describe, expect, it } from "vitest";
import { isWriteMongo, isWriteSql } from "../write-detect";

describe("isWriteSql", () => {
  it.each([
    "SELECT * FROM users",
    "  select 1",
    "(SELECT 1)",
    "WITH a AS (SELECT 1) SELECT * FROM a",
    "VALUES (1), (2)",
    "TABLE users",
    "SHOW search_path",
    "EXPLAIN SELECT 1",
    "PRAGMA table_info(users)",
    "-- just a comment\nSELECT 1",
    "/* lead */ SELECT 1",
    "",
    "   ",
    "-- only a comment",
  ])("treats %j as a read", (sql) => {
    expect(isWriteSql(sql)).toBe(false);
  });

  it.each([
    "INSERT INTO t VALUES (1)",
    "update t set a = 1 where id = 2",
    "DELETE FROM t",
    "DROP TABLE t",
    "TRUNCATE t",
    "CREATE INDEX i ON t (a)",
    "ALTER TABLE t ADD COLUMN c int",
    "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE",
    "REFRESH MATERIALIZED VIEW v",
    "-- note\nDELETE FROM t",
    "PRAGMA journal_mode = WAL",
    "SET default_transaction_read_only = off",
    "WITH gone AS (DELETE FROM t RETURNING *) SELECT * FROM gone",
    "12345",
  ])("treats %j as a write", (sql) => {
    expect(isWriteSql(sql)).toBe(true);
  });

  it("is not fooled by write words inside strings or comments", () => {
    expect(isWriteSql("SELECT 'delete from t' AS note")).toBe(false);
    expect(isWriteSql("SELECT 1 -- then DELETE FROM t")).toBe(false);
    expect(isWriteSql("WITH a AS (SELECT 'update' AS v) SELECT * FROM a")).toBe(
      false,
    );
  });
});

describe("isWriteMongo", () => {
  it.each([
    "db.users.insertOne({a: 1})",
    "db.users.updateMany({}, {$set: {a: 1}})",
    "db.users.deleteOne({_id: 1})",
    "db.users.drop()",
    "db.users.findOneAndUpdate({a: 1}, {$set: {a: 2}})",
    'db.users.aggregate([{$match: {a: 1}}, {$out: "copy"}])',
    'db.users.aggregate([{$merge: {into: "copy"}}])',
    "db.runCommand({drop: 'users'})",
    "db.adminCommand({shutdown: 1})",
  ])("treats %j as a write", (cmd) => {
    expect(isWriteMongo(cmd)).toBe(true);
  });

  it.each([
    "db.users.find({a: 1})",
    "db.users.countDocuments({})",
    "db.users.aggregate([{$match: {a: 1}}, {$group: {_id: '$a'}}])",
    "show collections",
    "use shop",
  ])("treats %j as a read", (cmd) => {
    expect(isWriteMongo(cmd)).toBe(false);
  });
});
