import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { listDatabases, listSchemaObjects } = vi.hoisted(() => ({
  listDatabases: vi.fn(() => Promise.resolve(["shop", "logs"])),
  listSchemaObjects: vi.fn((_c: string, _s: string, _k: string, db: string) =>
    Promise.resolve(
      (db === "logs" ? ["events", "errors"] : ["orders", "users"]).map(
        (name) => ({ name }),
      ),
    ),
  ),
}));
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  listDatabases,
  listSchemaObjects,
}));

import { CollectionPicker } from "../collection-picker";

describe("CollectionPicker", () => {
  beforeEach(() => {
    listSchemaObjects.mockClear();
  });

  it("shows the database and the collection as two dropdowns", () => {
    render(
      <CollectionPicker
        conn_id="c1"
        database="shop"
        collection="orders"
        onPick={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Database" })).toHaveTextContent(
      "shop",
    );
    expect(
      screen.getByRole("button", { name: "Collection" }),
    ).toHaveTextContent("orders");
  });

  it("picks a collection in the same database", async () => {
    const onPick = vi.fn();
    render(
      <CollectionPicker
        conn_id="c1"
        database="shop"
        collection="orders"
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collection" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "users" }));
    expect(onPick).toHaveBeenCalledWith("shop", "users");
  });

  it("another database opens its collections and switches only on a pick", async () => {
    const onPick = vi.fn();
    render(
      <CollectionPicker
        conn_id="c1"
        database="shop"
        collection="orders"
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Database" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "logs" }));
    expect(onPick).not.toHaveBeenCalled();

    const events = await screen.findByRole("menuitem", { name: "events" });
    expect(listSchemaObjects).toHaveBeenLastCalledWith(
      "c1",
      "",
      "table",
      "logs",
    );
    fireEvent.click(events);
    expect(onPick).toHaveBeenCalledWith("logs", "events");
  });

  it("goes back to the tab's database when the collection list closes unpicked", async () => {
    render(
      <CollectionPicker
        conn_id="c1"
        database="shop"
        collection="orders"
        onPick={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Database" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "logs" }));
    await screen.findByRole("menuitem", { name: "events" });
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Database" }),
      ).toHaveTextContent("shop"),
    );
  });
});
