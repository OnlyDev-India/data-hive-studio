import type { StoreApi } from "zustand";
import type { SchemaObjectKind } from "../api/types";
import type { StudioStore } from "./types";

type SetState = StoreApi<StudioStore>["setState"];

export interface TableDialogTarget {
  kind: "drop" | "duplicate" | "grants";
  connId: string;
  table: string;
  /** Undefined = the connection's own database. Mongo always names it. */
  database?: string;
  schema?: string;
  objectKind: SchemaObjectKind;
  /** Names a duplicate may not take. Empty skips the check. */
  taken?: string[];
}

export interface CatalogChange {
  database?: string;
  schema?: string;
  objectKind: SchemaObjectKind;
  /** Goes up on every change, so a repeat still fires. */
  seq: number;
}

let change_seq = 0;

/** The Drop, Duplicate and Grants dialogs, shared by the sidebar and the
 *  diagram, and the catalog changes they make. */
export function tableDialogActions(set: SetState) {
  return {
    tableDialog: null as TableDialogTarget | null,
    tableDialogBusy: false,
    openTableDialog(target: TableDialogTarget) {
      set((s) => (s.tableDialogBusy ? s : { tableDialog: target }));
    },
    closeTableDialog() {
      set((s) => (s.tableDialogBusy ? s : { tableDialog: null }));
    },
    setTableDialogBusy(busy: boolean) {
      set({ tableDialogBusy: busy });
    },
    catalogChanges: {} as Record<string, CatalogChange>,
    noteCatalogChange(connId: string, change: Omit<CatalogChange, "seq">) {
      set((s) => ({
        catalogChanges: {
          ...s.catalogChanges,
          [connId]: { ...change, seq: ++change_seq },
        },
      }));
    },
  };
}
