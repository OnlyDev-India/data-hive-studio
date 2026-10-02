import { describe, expect, it } from "vitest";
import {
  ALL_TABLE_ACTIONS,
  DIAGRAM_TABLE_ACTIONS,
  READ_ONLY_TITLE,
  tableMenuItems,
} from "../table-menu-items";

const kinds = [
  { name: "Postgres table", mongo: false, pg: true },
  { name: "SQLite table", mongo: false, pg: false },
  { name: "Mongo collection", mongo: true, pg: false },
];

const shape = (items: ReturnType<typeof tableMenuItems>) =>
  items.map(
    ({ action, label, disabled, title, destructive, separatorBefore }) => ({
      action,
      label,
      disabled,
      title,
      destructive,
      separatorBefore,
    }),
  );

describe("tableMenuItems", () => {
  for (const k of kinds)
    for (const readOnly of [false, true])
      it(`gives the sidebar and the canvas one list: ${k.name}, read only ${readOnly}`, () => {
        const base = {
          mongo: k.mongo,
          pg: k.pg,
          objectKind: "table",
          readOnly,
        };
        const sidebar = tableMenuItems({ ...base, offer: ALL_TABLE_ACTIONS });
        const canvas = tableMenuItems({
          ...base,
          offer: DIAGRAM_TABLE_ACTIONS,
        });
        expect(shape(canvas)).toEqual(shape(sidebar));
        expect(canvas.map((i) => i.icon)).toEqual(sidebar.map((i) => i.icon));
      });

  it("orders a Postgres table's items like the sidebar, Drop last after a separator", () => {
    const items = tableMenuItems({
      mongo: false,
      pg: true,
      objectKind: "table",
      readOnly: false,
      offer: DIAGRAM_TABLE_ACTIONS,
    });
    expect(items.map((i) => i.label)).toEqual([
      "Open table",
      "View structure",
      "Compare with…",
      "View grants",
      "Copy table name",
      "Duplicate table",
      "Import into table…",
      "Drop table…",
    ]);
    const drop = items[items.length - 1];
    expect(drop.destructive).toBe(true);
    expect(drop.separatorBefore).toBe(true);
  });

  it("says collection on Mongo and leaves out View grants", () => {
    const items = tableMenuItems({
      mongo: true,
      pg: false,
      objectKind: "table",
      readOnly: false,
      offer: DIAGRAM_TABLE_ACTIONS,
    });
    expect(items.some((i) => i.action === "grants")).toBe(false);
    expect(items.map((i) => i.label)).toContain("Drop collection…");
    expect(items.every((i) => !i.label.includes("table"))).toBe(true);
  });

  it("disables Duplicate, Import and Drop on a read only connection", () => {
    const items = tableMenuItems({
      mongo: false,
      pg: true,
      objectKind: "table",
      readOnly: true,
      offer: DIAGRAM_TABLE_ACTIONS,
    });
    const off = items.filter((i) => i.disabled).map((i) => i.action);
    expect(off).toEqual(["duplicate", "import", "drop"]);
    for (const i of items.filter((i) => i.disabled))
      expect(i.title).toBe(READ_ONLY_TITLE);
  });

  it("offers Refresh materialized view only in the sidebar", () => {
    const base = {
      mongo: false,
      pg: true,
      objectKind: "materialized_view",
      readOnly: false,
    };
    const has = (offer: ReadonlySet<never> | typeof ALL_TABLE_ACTIONS) =>
      tableMenuItems({ ...base, offer }).some(
        (i) => i.action === "refresh_matview",
      );
    expect(has(ALL_TABLE_ACTIONS)).toBe(true);
    expect(has(DIAGRAM_TABLE_ACTIONS)).toBe(false);
  });

  it("shows only what the caller offers", () => {
    const items = tableMenuItems({
      mongo: false,
      pg: true,
      objectKind: "table",
      readOnly: false,
      offer: new Set(["open", "copy"]),
    });
    expect(items.map((i) => i.action)).toEqual(["open", "copy"]);
  });
});
