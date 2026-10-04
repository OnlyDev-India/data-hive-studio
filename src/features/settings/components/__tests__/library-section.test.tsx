import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/shared/api/web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api/web")>()),
  WEB: true,
}));

import { useStudioStore } from "@/shared/store";
import type { ConnectionInfo } from "@/shared/api/types";
import type { LibraryItem } from "@/shared/library/types";
import { LibrarySection } from "../library-section";

const item = (over: Partial<LibraryItem>): LibraryItem => ({
  id: "x",
  kind: "query",
  language: "sql",
  name: "Item",
  text: "SELECT 1",
  trigger: null,
  created_at: 1,
  updated_at: 1,
  ...over,
});

const library = [
  item({ id: "q", name: "Active users", updated_at: 3 }),
  item({
    id: "m",
    name: "Mongo orders",
    language: "mongo",
    text: "db.orders.find()",
    updated_at: 2,
  }),
  item({
    id: "s",
    name: "Select rows",
    kind: "snippet",
    trigger: "sel",
    updated_at: 1,
  }),
];

const conn = (kind: ConnectionInfo["kind"]): ConnectionInfo => ({
  id: "c1",
  name: "db",
  kind,
});

const names = () =>
  within(screen.getByRole("list", { name: "Library items" }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("span")?.textContent);

beforeEach(() => {
  useStudioStore.setState({ library, open: [], activeId: null });
});

describe("Library settings", () => {
  it("lists newest first and filters by search, kind and language", () => {
    render(<LibrarySection onClose={() => {}} />);
    expect(names()).toEqual(["Active users", "Mongo orders", "Select rows"]);

    fireEvent.change(screen.getByLabelText("Search the library"), {
      target: { value: "SEL" },
    });
    // "Select rows" by name, and both SQL texts contain SELECT.
    expect(names()).toEqual(["Active users", "Select rows"]);

    fireEvent.click(
      within(screen.getByRole("group", { name: "Kind" })).getByText("Snippets"),
    );
    expect(names()).toEqual(["Select rows"]);

    fireEvent.click(
      within(screen.getByRole("group", { name: "Language" })).getByText(
        "Mongo",
      ),
    );
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("shows its own empty state when the library is empty", () => {
    useStudioStore.setState({ library: [] });
    render(<LibrarySection onClose={() => {}} />);
    expect(screen.getByText("Your library is empty")).toBeInTheDocument();
  });

  it("offers Open in editor on queries only, off without a connection", () => {
    render(<LibrarySection onClose={() => {}} />);
    const buttons = screen.getAllByRole("button", { name: /Open in editor/ });
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b).toBeDisabled();
  });

  it("enables only the queries whose language matches the active connection", () => {
    useStudioStore.setState({ open: [conn("mongodb")], activeId: "c1" });
    render(<LibrarySection onClose={() => {}} />);
    const [sql, mongo] = screen.getAllByRole("button", {
      name: /Open in editor/,
    });
    expect(sql).toBeDisabled();
    expect(mongo).toBeEnabled();
  });

  it("opens a query in a new tab and closes Settings", () => {
    const openSql = vi.fn();
    const onClose = vi.fn();
    useStudioStore.setState({
      open: [conn("postgres")],
      activeId: "c1",
      openSql,
    });
    render(<LibrarySection onClose={onClose} />);
    fireEvent.click(
      screen.getAllByRole("button", { name: /Open in editor/ })[0],
    );
    expect(openSql).toHaveBeenCalledWith("c1", "SELECT 1");
    expect(onClose).toHaveBeenCalled();
  });

  it("asks before deleting", () => {
    const deleteLibraryItem = vi.fn(() => Promise.resolve(true));
    useStudioStore.setState({ deleteLibraryItem });
    render(<LibrarySection onClose={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Active users" }),
    );
    expect(deleteLibraryItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteLibraryItem).toHaveBeenCalledWith("q");
  });
});
