import { describe, it, expect } from "vitest";
import { formatQueryPreview } from "./query-preview";

describe("formatQueryPreview (SQL)", () => {
  it("formats a plain SELECT with no filters", () => {
    expect(
      formatQueryPreview({ kind: "select", table: "users" }, 100, false),
    ).toBe('SELECT * FROM "users" LIMIT 100');
  });

  it("uses custom_where verbatim when set", () => {
    expect(
      formatQueryPreview(
        { kind: "select", table: "users", custom_where: "age >= 18" },
        50,
        false,
      ),
    ).toBe('SELECT * FROM "users" WHERE age >= 18 LIMIT 50');
  });

  it("builds a WHERE clause from structured filters, joined by conjunction", () => {
    const preview = formatQueryPreview(
      {
        kind: "select",
        table: "orders",
        filters: [
          { column: "status", op: "eq", value: "pending" },
          { column: "total", op: "gt", value: "100", conjunction: "AND" },
        ],
      },
      100,
      false,
    );
    expect(preview).toBe(
      "SELECT * FROM \"orders\" WHERE status = 'pending' AND total > '100' LIMIT 100",
    );
  });

  it("includes ORDER BY when set", () => {
    expect(
      formatQueryPreview(
        {
          kind: "select",
          table: "users",
          order_by: "created_at",
          order_dir: "DESC",
        },
        20,
        false,
      ),
    ).toBe('SELECT * FROM "users" ORDER BY created_at DESC LIMIT 20');
  });
});

describe("formatQueryPreview (Mongo)", () => {
  it("formats a bare find() with no filters", () => {
    expect(
      formatQueryPreview({ kind: "select", table: "users" }, 100, true),
    ).toBe("db.users.find({}).limit(100)");
  });

  it("uses custom_where verbatim as the filter argument when set", () => {
    expect(
      formatQueryPreview(
        {
          kind: "select",
          table: "users",
          custom_where: '{ "age": { "$gte": 18 } }',
        },
        50,
        true,
      ),
    ).toBe('db.users.find({ "age": { "$gte": 18 } }).limit(50)');
  });

  it("builds a filter object from structured filters", () => {
    expect(
      formatQueryPreview(
        {
          kind: "select",
          table: "orders",
          filters: [{ column: "status", op: "eq", value: "pending" }],
        },
        100,
        true,
      ),
    ).toBe('db.orders.find({ status: "pending" }).limit(100)');
  });

  it("includes .sort() when order_by is set", () => {
    expect(
      formatQueryPreview(
        {
          kind: "select",
          table: "users",
          order_by: "createdAt",
          order_dir: "DESC",
        },
        20,
        true,
      ),
    ).toBe("db.users.find({}).sort({ createdAt: -1 }).limit(20)");
  });
});
