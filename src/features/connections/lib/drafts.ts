import { create } from "zustand";
import type { SavedDbKind } from "@/shared/api";
import type { LandingEditTarget, SavedConnParams } from "@/shared/store";
import {
  DOCUMENTDB_DEFAULTS,
  MONGO_DEFAULTS,
  PG_DEFAULTS,
  SQLITE_DEFAULTS,
  withDocumentDbDefaults,
} from "./defaults";
import type { GuardFormValues } from "./guard-form";
import type {
  MongoFormValues,
  PgFormValues,
  SqliteFormValues,
} from "./form-values";
import {
  mongoFormFromSaved,
  pgFormFromSaved,
  sqliteFormFromSaved,
} from "./from-saved";
import type { FormDraft } from "./tab-fields";

// Outside the card so drafts survive leaving the home screen; memory only.

export type ConnectionStep = "pick" | "form";

interface DraftsState {
  step: ConnectionStep;
  kind: SavedDbKind;
  pg: PgFormValues;
  mongo: MongoFormValues;
  sqlite: SqliteFormValues;
  edit: LandingEditTarget | null;
  /** Bumped on a load or reset so the form drops its tab, errors and test result. */
  visit: number;
}

interface DraftsActions {
  pickKind: (kind: SavedDbKind) => void;
  openForm: () => void;
  backToPicker: () => void;
  patchPg: (patch: Partial<PgFormValues>) => void;
  patchMongo: (patch: Partial<MongoFormValues>) => void;
  patchSqlite: (patch: Partial<SqliteFormValues>) => void;
  setEdit: (edit: LandingEditTarget | null) => void;
  loadSaved: (
    kind: SavedDbKind,
    params: SavedConnParams,
    edit: LandingEditTarget | null,
  ) => void;
  reset: () => void;
}

const FRESH: DraftsState = {
  step: "pick",
  kind: "postgres",
  pg: PG_DEFAULTS,
  mongo: MONGO_DEFAULTS,
  sqlite: SQLITE_DEFAULTS,
  edit: null,
  visit: 0,
};

export const useConnectionDrafts = create<DraftsState & DraftsActions>()(
  (set) => ({
    ...FRESH,
    pickKind: (kind) =>
      set((s) => {
        const next = s.edit ? carryEntry(s, kind) : {};
        const mongo = next.mongo ?? s.mongo;
        return kind === "documentdb" && s.kind !== "documentdb"
          ? { ...next, kind, mongo: withDocumentDbDefaults(mongo) }
          : { ...next, kind };
      }),
    openForm: () => set({ step: "form" }),
    backToPicker: () => set({ step: "pick" }),
    patchPg: (patch) => set((s) => ({ pg: { ...s.pg, ...patch } })),
    patchMongo: (patch) => set((s) => ({ mongo: { ...s.mongo, ...patch } })),
    patchSqlite: (patch) => set((s) => ({ sqlite: { ...s.sqlite, ...patch } })),
    setEdit: (edit) => set({ edit }),
    loadSaved: (kind, params, edit) =>
      set((s) => {
        const base = { kind, edit, step: "form" as const, visit: s.visit + 1 };
        if (kind === "sqlite")
          return { ...base, sqlite: sqliteFormFromSaved(params) };
        if (kind === "postgres")
          return { ...base, pg: pgFormFromSaved(params) };
        return { ...base, mongo: mongoFormFromSaved(params) };
      }),
    reset: () => set((s) => ({ ...FRESH, visit: s.visit + 1 })),
  }),
);

const draftGroup = (kind: SavedDbKind) =>
  kind === "sqlite" ? "sqlite" : kind === "postgres" ? "pg" : "mongo";

/** Editing one saved entry under another kind keeps its name and safety settings. */
function carryEntry(
  s: DraftsState,
  kind: SavedDbKind,
): Partial<Pick<DraftsState, "pg" | "mongo" | "sqlite">> {
  const from = draftGroup(s.kind);
  const to = draftGroup(kind);
  if (from === to) return {};
  const src = from === "sqlite" ? s.sqlite : s[from];
  const guard: GuardFormValues =
    "guard" in src
      ? src.guard
      : {
          read_only: src.read_only,
          env_label: src.env_label,
          env_color: src.env_color,
          confirm_writes: src.confirm_writes,
        };
  if (to === "sqlite")
    return { sqlite: { ...s.sqlite, name: src.name, guard } };
  return { [to]: { ...s[to], name: src.name, ...guard } };
}

export function currentDraft(s: DraftsState): FormDraft {
  if (s.kind === "sqlite") return { kind: "sqlite", values: s.sqlite };
  if (s.kind === "postgres") return { kind: "postgres", values: s.pg };
  return { kind: s.kind, values: s.mongo };
}

const same = <T extends object>(a: T, b: T) =>
  (Object.keys(a) as (keyof T)[]).every((k) => a[k] === b[k]);

/** Picking a card alone doesn't count as typing. */
export function isFreshCard(s: DraftsState): boolean {
  return (
    s.step === "pick" &&
    s.edit === null &&
    same(s.pg, PG_DEFAULTS) &&
    (same(s.mongo, MONGO_DEFAULTS) || same(s.mongo, DOCUMENTDB_DEFAULTS)) &&
    s.sqlite.path === null &&
    s.sqlite.name === "" &&
    same(s.sqlite.guard, SQLITE_DEFAULTS.guard)
  );
}
