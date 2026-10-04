import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/shared/api/web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/web")>()),
  WEB: true,
}));

import { useStudioStore } from "../store";
import { WEB_LIBRARY_BACKUP_KEY, WEB_LIBRARY_KEY } from "../../api/library";
import { STARTER_SNIPPETS } from "../../library/starters";
import type { LibraryFile, LibraryItem } from "../../library/types";

const stored = (): LibraryFile =>
  JSON.parse(localStorage.getItem(WEB_LIBRARY_KEY) ?? "null");

const store = () => useStudioStore.getState();

const mine: LibraryItem = {
  id: "mine",
  kind: "snippet",
  language: "sql",
  name: "My select",
  text: "SELECT 1",
  trigger: "SEL",
  created_at: 1,
  updated_at: 1,
};

beforeEach(() => {
  localStorage.clear();
  useStudioStore.setState({
    library: [],
    librarySeeded: false,
    notifications: [],
  });
});

describe("starter snippets", () => {
  it("are added once to a library that does not exist yet", async () => {
    await store().loadLibrary();
    expect(store().library).toHaveLength(STARTER_SNIPPETS.length);
    expect(stored().seeded).toBe(true);
    expect(stored().items).toHaveLength(STARTER_SNIPPETS.length);
  });

  it("skip a starter whose trigger is already taken in an unseeded library", async () => {
    localStorage.setItem(
      WEB_LIBRARY_KEY,
      JSON.stringify({ version: 1, seeded: false, items: [mine] }),
    );
    await store().loadLibrary();
    const sel = store().library.filter(
      (i) => i.trigger?.toLowerCase() === "sel",
    );
    expect(sel.map((i) => i.id)).toEqual(["mine"]);
    expect(store().library).toHaveLength(STARTER_SNIPPETS.length);
  });

  it("do not come back after one is deleted", async () => {
    await store().loadLibrary();
    const first = store().library[0];
    await store().deleteLibraryItem(first.id);
    useStudioStore.setState({ library: [], librarySeeded: false });
    await store().loadLibrary();
    expect(store().library.map((i) => i.id)).not.toContain(first.id);
    expect(store().library).toHaveLength(STARTER_SNIPPETS.length - 1);
  });
});

describe("an unreadable library", () => {
  it("is backed up, reset empty and seeded, with one notification", async () => {
    localStorage.setItem(WEB_LIBRARY_KEY, '{"version":1,"items":[');
    await store().loadLibrary();
    expect(localStorage.getItem(WEB_LIBRARY_BACKUP_KEY)).toBe(
      '{"version":1,"items":[',
    );
    expect(store().library).toEqual([]);
    expect(store().librarySeeded).toBe(true);
    expect(store().notifications).toHaveLength(1);
    expect(store().notifications[0].detail).toContain(WEB_LIBRARY_BACKUP_KEY);

    useStudioStore.setState({ notifications: [] });
    await store().loadLibrary();
    expect(store().notifications).toHaveLength(0);
    expect(store().library).toEqual([]);
  });

  it("is recovered when the shape is wrong", async () => {
    localStorage.setItem(
      WEB_LIBRARY_KEY,
      JSON.stringify({ version: 2, seeded: true, items: [] }),
    );
    await store().loadLibrary();
    expect(localStorage.getItem(WEB_LIBRARY_BACKUP_KEY)).not.toBeNull();
    expect(store().librarySeeded).toBe(true);
  });
});

describe("saving", () => {
  beforeEach(() => {
    localStorage.setItem(
      WEB_LIBRARY_KEY,
      JSON.stringify({ version: 1, seeded: true, items: [mine] }),
    );
  });

  it("refuses a trigger that differs only in case, and saves nothing", async () => {
    await store().loadLibrary();
    const r = await store().addLibraryItem({
      kind: "snippet",
      language: "sql",
      name: "Other",
      text: "SELECT 2",
      trigger: "sel",
    });
    expect(r).toMatchObject({ ok: false, field: "trigger" });
    expect(stored().items).toHaveLength(1);
  });

  it("adds an item with an id and timestamps, and an edit moves updated_at", async () => {
    await store().loadLibrary();
    const added = await store().addLibraryItem({
      kind: "query",
      language: "mongo",
      name: "Active",
      text: "db.users.find()",
      trigger: null,
    });
    if (!added.ok) throw new Error(added.message);
    expect(stored().items).toHaveLength(2);
    const later = vi
      .spyOn(Date, "now")
      .mockReturnValue(added.item.updated_at + 5);
    const edited = await store().updateLibraryItem(added.item.id, {
      ...added.item,
      name: "Active users",
    });
    later.mockRestore();
    expect(edited).toMatchObject({
      ok: true,
      item: {
        name: "Active users",
        created_at: added.item.created_at,
        updated_at: added.item.updated_at + 5,
      },
    });
  });

  it("leaves the library unchanged when storage refuses the write", async () => {
    await store().loadLibrary();
    const realSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key, value) {
        if (key === WEB_LIBRARY_KEY) throw new Error("QuotaExceededError");
        realSetItem.call(this, key, value);
      });
    const r = await store().deleteLibraryItem("mine");
    setItem.mockRestore();
    expect(r).toBe(false);
    expect(store().library).toHaveLength(1);
    expect(store().notifications[0].title).toBe("Could not save your library");
  });

  it("refuses an import that is not an export file", async () => {
    await store().loadLibrary();
    expect(await store().importLibrary("not json")).toBeNull();
    expect(await store().importLibrary('{"items":[]}')).toBeNull();
    expect(store().library).toHaveLength(1);
    expect(store().notifications).toHaveLength(2);
  });

  it("imports without touching seeded", async () => {
    localStorage.setItem(
      WEB_LIBRARY_KEY,
      JSON.stringify({ version: 1, seeded: false, items: [] }),
    );
    useStudioStore.setState({ library: [], librarySeeded: true });
    const summary = await store().importLibrary(
      JSON.stringify({
        version: 1,
        items: [{ ...mine, id: "x", trigger: "zz" }],
      }),
    );
    expect(summary?.added).toBe(1);
    expect(stored().seeded).toBe(true);
  });

  it("picks up a change another tab made", async () => {
    await store().loadLibrary();
    const next = { version: 1, seeded: true, items: [] };
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: WEB_LIBRARY_KEY,
        newValue: JSON.stringify(next),
      }),
    );
    expect(store().library).toEqual([]);
  });
});
