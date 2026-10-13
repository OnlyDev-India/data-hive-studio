import { describe, expect, it } from "vitest";
import type { GraphLink } from "@/shared/api";
import type { Clause, ClauseKind } from "@/shared/store";
import { aliasFor, joinSuggestions, tableIdent } from "../joins";
import { newClause } from "../model";

const card = (kind: ClauseKind, body: string): Clause => ({
  ...newClause(kind, body),
  id: kind + body,
});

const link = (
  from_table: string,
  from: string,
  to_table: string,
  to: string,
): GraphLink => ({
  id: `${from_table}.${from}`,
  from_schema: "public",
  from_table,
  from_columns: [from],
  to_schema: "public",
  to_table,
  to_columns: [to],
  inferred: false,
});

describe("joinSuggestions", () => {
  const links = [
    link("orders", "customer_id", "customers", "id"),
    link("order_items", "order_id", "orders", "id"),
    link("payments", "invoice_id", "invoices", "id"),
  ];

  it("suggests tables linked either way, ON as child.fk = parent.pk", () => {
    const s = joinSuggestions(
      [card("from", "orders o")],
      links,
      "public",
      "postgresql",
    );
    expect(s).toEqual([
      {
        table: { schema: "public", name: "customers" },
        on: [{ left: "o.customer_id", right: "customers.id" }],
      },
      {
        table: { schema: "public", name: "order_items" },
        on: [{ left: "order_items.order_id", right: "o.id" }],
      },
    ]);
  });

  it("aliases a table the query already reads", () => {
    const q = [
      card("from", "orders"),
      card("join", "JOIN customers ON customers.id = orders.customer_id"),
    ];
    expect(aliasFor(q, "customers", "postgresql")).toBe("customers_2");
    expect(aliasFor(q, "invoices", "postgresql")).toBeNull();
    const s = joinSuggestions(q, links, "public", "postgresql");
    expect(s[0].on[0].right).toBe("customers_2.id");
  });
});

describe("tableIdent", () => {
  it("writes a table bare in the tab's schema and qualified elsewhere", () => {
    expect(
      tableIdent({ schema: "public", name: "orders" }, "public", "postgresql"),
    ).toBe("orders");
    expect(
      tableIdent({ schema: "crm", name: "People" }, "public", "postgresql"),
    ).toBe('crm."People"');
    expect(tableIdent({ schema: null, name: "orders" }, null, "sqlite")).toBe(
      "orders",
    );
  });
});
