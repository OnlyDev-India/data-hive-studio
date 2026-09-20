import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TITLE_BAR_MENUS } from "../menu-schema";

const items = TITLE_BAR_MENUS.flatMap((m) =>
  m.items.flatMap((i) => ("separator" in i ? [] : [{ menu: m.label, ...i }])),
);

describe("title bar menu matches the macOS menu bar", () => {
  it("has every top level menu the native bar has", () => {
    expect(TITLE_BAR_MENUS.map((m) => m.label)).toEqual([
      "File",
      "Edit",
      "View",
      "Connection",
      "Window",
      "Help",
    ]);
  });

  it("has every custom item id declared in app_menu.rs", () => {
    const rust = readFileSync(
      resolve(__dirname, "../../../../src-tauri/src/app_menu.rs"),
      "utf8",
    );
    const nativeIds = new Set(
      [...rust.matchAll(/"((?:file|view|connection|help)\.[a-z_]+)"/g)].map(
        (m) => m[1],
      ),
    );
    expect(nativeIds.size).toBeGreaterThan(0);
    const ids = new Set(items.map((i) => i.id));
    for (const id of nativeIds) expect(ids, id).toContain(id);
  });

  it("carries the items the native Edit, Window, View and app menus provide", () => {
    const labelsIn = (menu: string) =>
      items.filter((i) => i.menu === menu).map((i) => i.label);
    expect(labelsIn("Edit")).toEqual([
      "Undo",
      "Redo",
      "Cut",
      "Copy",
      "Paste",
      "Select All",
    ]);
    expect(labelsIn("Window")).toEqual([
      "Minimize",
      "Maximize",
      "Close Window",
    ]);
    expect(labelsIn("View")).toEqual(
      expect.arrayContaining(["Toggle Developer Tools", "Toggle Full Screen"]),
    );
    expect(labelsIn("File")).toContain("Quit");
    expect(labelsIn("Help")).toContain("About DH Studio");
  });

  it("uses each id once", () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
