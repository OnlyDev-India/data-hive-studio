import { describe, it, expect } from "vitest";
import { singleTableSelect } from "../sql-editable";

describe("singleTableSelect", () => {
  it("accepts a plain SELECT with explicit columns", () => {
    expect(singleTableSelect("SELECT id, name FROM users")).toEqual({
      table: "users",
    });
  });

  it("accepts SELECT *", () => {
    expect(singleTableSelect("SELECT * FROM users")).toEqual({
      table: "users",
    });
  });

  it("accepts WHERE / ORDER BY / LIMIT / OFFSET", () => {
    expect(
      singleTableSelect(
        "SELECT * FROM users WHERE active = 1 ORDER BY id DESC LIMIT 10 OFFSET 5",
      ),
    ).toEqual({ table: "users" });
  });

  it("accepts a schema-qualified table", () => {
    expect(singleTableSelect("SELECT * FROM app.users")).toEqual({
      table: "app.users",
    });
  });

  it("accepts a table alias in FROM (doesn't affect column identity)", () => {
    expect(singleTableSelect("SELECT id FROM users u WHERE u.id = 1")).toEqual({
      table: "users",
    });
  });

  it("rejects a JOIN", () => {
    expect(
      singleTableSelect(
        "SELECT * FROM users JOIN orders ON orders.user_id = users.id",
      ),
    ).toBeNull();
  });

  it("rejects GROUP BY", () => {
    expect(
      singleTableSelect("SELECT status, count(*) FROM orders GROUP BY status"),
    ).toBeNull();
  });

  it("rejects DISTINCT", () => {
    expect(singleTableSelect("SELECT DISTINCT status FROM orders")).toBeNull();
  });

  it("rejects a computed/aliased column", () => {
    expect(
      singleTableSelect("SELECT id, upper(name) AS name FROM users"),
    ).toBeNull();
    expect(singleTableSelect("SELECT id AS user_id FROM users")).toBeNull();
  });

  it("rejects a subquery in FROM", () => {
    expect(
      singleTableSelect("SELECT * FROM (SELECT * FROM users) t"),
    ).toBeNull();
  });

  it("rejects multiple statements", () => {
    expect(
      singleTableSelect("SELECT * FROM users; SELECT * FROM orders"),
    ).toBeNull();
  });

  it("rejects an INSERT/UPDATE/DELETE statement", () => {
    expect(singleTableSelect("UPDATE users SET name = 'x'")).toBeNull();
  });

  it("rejects unparseable SQL", () => {
    expect(singleTableSelect("not sql at all (((")).toBeNull();
  });
});
