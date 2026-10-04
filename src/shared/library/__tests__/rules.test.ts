import { describe, it, expect } from "vitest";
import {
  checkDraft,
  matchesSearch,
  mergeImport,
  newestFirst,
  parseExportFile,
  parseLibraryFile,
} from "../rules";
import type { LibraryDraft, LibraryItem } from "../types";

const item = (over: Partial<LibraryItem> = {}): LibraryItem => ({
  id: "a",
  kind: "snippet",
  language: "sql",
  name: "Select rows",
  text: "SELECT ${1:*} FROM ${2:table};",
  trigger: "sel",
  created_at: 1,
  updated_at: 10,
  ...over,
});

const draft = (over: Partial<LibraryDraft> = {}): LibraryDraft => ({
  kind: "snippet",
  language: "sql",
  name: "Top rows",
  text: "SELECT TOP 10 *",
  trigger: "top",
  ...over,
});

describe("checkDraft", () => {
  it("accepts a valid snippet and trims the name and trigger", () => {
    const r = checkDraft(draft({ name: "  Top  ", trigger: " top " }), []);
    expect(r).toEqual({
      ok: true,
      draft: draft({ name: "Top", trigger: "top" }),
    });
  });

  it("refuses a blank or too long name", () => {
    expect(checkDraft(draft({ name: "   " }), [])).toMatchObject({
      ok: false,
      field: "name",
    });
    expect(checkDraft(draft({ name: "x".repeat(81) }), [])).toMatchObject({
      ok: false,
      field: "name",
    });
    expect(checkDraft(draft({ name: "x".repeat(80) }), []).ok).toBe(true);
  });

  it("refuses blank or too long text", () => {
    expect(checkDraft(draft({ text: " \n\t" }), [])).toMatchObject({
      ok: false,
      field: "text",
    });
    expect(checkDraft(draft({ text: "x".repeat(100_001) }), [])).toMatchObject({
      ok: false,
      field: "text",
    });
    expect(checkDraft(draft({ text: "x".repeat(100_000) }), []).ok).toBe(true);
  });

  it("refuses a trigger with other characters or over 32", () => {
    for (const trigger of ["has space", "a-b", "é", "x".repeat(33)])
      expect(checkDraft(draft({ trigger }), [])).toMatchObject({
        ok: false,
        field: "trigger",
      });
    expect(checkDraft(draft({ trigger: "A_1" }), []).ok).toBe(true);
  });

  it("refuses a trigger that differs only in case from another snippet of the language", () => {
    const r = checkDraft(draft({ trigger: "SEL" }), [item()]);
    expect(r).toMatchObject({ ok: false, field: "trigger" });
  });

  it("allows the same trigger in the other language, and on the item itself", () => {
    expect(
      checkDraft(draft({ trigger: "sel", language: "mongo" }), [item()]).ok,
    ).toBe(true);
    expect(checkDraft(draft({ trigger: "sel" }), [item()], "a").ok).toBe(true);
  });

  it("gives a query no trigger, even when one was typed", () => {
    const r = checkDraft(draft({ kind: "query", trigger: "bad trigger" }), []);
    expect(r).toMatchObject({
      ok: true,
      draft: { kind: "query", trigger: null },
    });
  });

  it("treats a blank trigger as none", () => {
    expect(checkDraft(draft({ trigger: "  " }), [])).toMatchObject({
      ok: true,
      draft: { trigger: null },
    });
  });
});

describe("parseLibraryFile", () => {
  it("reads a version 1 file", () => {
    const file = { version: 1, seeded: true, items: [item()] };
    expect(parseLibraryFile(file)).toEqual(file);
  });

  it("refuses another version or a bad item", () => {
    expect(
      parseLibraryFile({ version: 2, seeded: true, items: [] }),
    ).toBeNull();
    expect(parseLibraryFile({ version: 1, items: [] })).toBeNull();
    expect(
      parseLibraryFile({ version: 1, seeded: true, items: [{ id: "a" }] }),
    ).toBeNull();
  });
});

describe("mergeImport", () => {
  it("adds, updates, keeps, clears triggers and skips, as the spec scenario counts", () => {
    const existing = [
      item({ id: "older", trigger: "o", updated_at: 50 }),
      item({ id: "newer", trigger: "n", updated_at: 50 }),
      item({ id: "taken", trigger: "dup", updated_at: 50 }),
    ];
    const incoming = [
      item({ id: "fresh", trigger: "f", updated_at: 1 }),
      item({ id: "older", trigger: "o", name: "Old copy", updated_at: 40 }),
      item({ id: "newer", trigger: "n", name: "New copy", updated_at: 60 }),
      item({ id: "clash", trigger: "DUP", updated_at: 1 }),
      item({ id: "blank", trigger: null, text: "  ", updated_at: 1 }),
    ];
    const { items, summary } = mergeImport(existing, incoming);
    expect(summary).toEqual({
      added: 1,
      updated: 1,
      unchanged: 1,
      triggersCleared: 1,
      skipped: 1,
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.older.name).toBe("Select rows");
    expect(byId.newer.name).toBe("New copy");
    expect(byId.clash.trigger).toBeNull();
    expect(byId.fresh).toBeDefined();
    expect(byId.blank).toBeUndefined();
  });

  it("keeps the existing copy on an equal updated_at", () => {
    const { items, summary } = mergeImport(
      [item({ updated_at: 5 })],
      [item({ name: "Other", updated_at: 5 })],
    );
    expect(summary.unchanged).toBe(1);
    expect(items[0].name).toBe("Select rows");
  });

  it("skips a malformed item", () => {
    expect(mergeImport([], [{ id: 3 }, "x"]).summary.skipped).toBe(2);
  });

  it("checks triggers against items imported earlier in the same file", () => {
    const { summary } = mergeImport(
      [],
      [item({ id: "1", trigger: "t" }), item({ id: "2", trigger: "T" })],
    );
    expect(summary).toMatchObject({ added: 1, triggersCleared: 1 });
  });
});

describe("parseExportFile", () => {
  it("needs version 1 and an items array", () => {
    expect(parseExportFile({ version: 1, items: [] })).toEqual([]);
    expect(parseExportFile({ version: 1 })).toBeNull();
    expect(parseExportFile([])).toBeNull();
  });
});

describe("search and order", () => {
  it("matches name, trigger and text, ignoring case", () => {
    const i = item({
      name: "Count orders",
      trigger: "cnto",
      text: "SELECT COUNT(*) FROM Orders",
    });
    expect(matchesSearch(i, "ORDERS")).toBe(true);
    expect(matchesSearch(i, "cnto")).toBe(true);
    expect(matchesSearch(i, "from orders")).toBe(true);
    expect(matchesSearch(i, "users")).toBe(false);
  });

  it("lists the newest update first", () => {
    const order = newestFirst([
      item({ id: "a", updated_at: 1 }),
      item({ id: "b", updated_at: 3 }),
      item({ id: "c", updated_at: 2 }),
    ]).map((i) => i.id);
    expect(order).toEqual(["b", "c", "a"]);
  });
});
