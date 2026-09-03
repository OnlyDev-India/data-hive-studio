import type { StoreApi } from "zustand";
import type {
  SchemaEditHandle,
  SchemaPaneHandle,
  StudioStore,
} from "@/shared/store/types";

type SetState = StoreApi<StudioStore>["setState"];
type NewTableHandle = StudioStore["newTables"][string];

/** Schema editor state: live handles panes register so the status bar can
 *  drive Apply/Discard, per-pane Refresh/Drop, and the New-table Create
 *  button — mirrors GridBridge for DDL instead of data edits. */
export function schemaDesignerActions(set: SetState) {
  return {
    // Schema edit handles (active schema tab -> status bar Apply/Discard)
    schemaEdits: {},
    setSchemaEdit(key: string, handle: SchemaEditHandle) {
      set((s) => ({ schemaEdits: { ...s.schemaEdits, [key]: handle } }));
    },
    clearSchemaEdit(key: string) {
      set((s) => {
        const next = { ...s.schemaEdits };
        delete next[key];
        return { schemaEdits: next };
      });
    },

    // Schema pane handles (open schema editor -> status bar Refresh/Drop table)
    schemaPanes: {},
    setSchemaPane(key: string, handle: SchemaPaneHandle) {
      set((s) => ({ schemaPanes: { ...s.schemaPanes, [key]: handle } }));
    },
    clearSchemaPane(key: string) {
      set((s) => {
        const next = { ...s.schemaPanes };
        delete next[key];
        return { schemaPanes: next };
      });
    },

    newTables: {},
    setNewTable(key: string, handle: NewTableHandle) {
      set((s) => ({ newTables: { ...s.newTables, [key]: handle } }));
    },
    clearNewTable(key: string) {
      set((s) => {
        const next = { ...s.newTables };
        delete next[key];
        return { newTables: next };
      });
    },
  };
}
