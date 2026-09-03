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
    // Explicit types (not just `{}`, which TS infers as the empty-object
    // type) so this slice's own return type is correct standalone —
    // matters for testing it in isolation (see schema-designer-slice.test.ts).
    schemaEdits: {} as Record<string, SchemaEditHandle | null>,
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
    schemaPanes: {} as Record<string, SchemaPaneHandle | null>,
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

    newTables: {} as Record<string, NewTableHandle>,
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
