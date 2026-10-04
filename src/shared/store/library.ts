import type { StoreApi } from "zustand";
import {
  loadLibrary as apiLoadLibrary,
  saveLibrary,
  watchWebLibrary,
} from "../api/library";
import { WEB } from "../api/web";
import {
  checkDraft,
  mergeImport,
  parseExportFile,
  summaryText,
} from "../library/rules";
import { STARTER_SNIPPETS } from "../library/starters";
import type {
  ImportSummary,
  LibraryDraft,
  LibraryFile,
  LibraryItem,
  LibraryResult,
} from "../library/types";
import type { StudioStore } from "./types";

type SetState = StoreApi<StudioStore>["setState"];
type GetState = StoreApi<StudioStore>["getState"];

/** Adds the starter snippets that pass the rules against `items`. */
export function withStarters(items: LibraryItem[], now: number): LibraryItem[] {
  const next = [...items];
  for (const starter of STARTER_SNIPPETS) {
    const check = checkDraft(starter, next);
    if (!check.ok) continue;
    next.push({
      ...check.draft,
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
    });
  }
  return next;
}

let queue: Promise<unknown> = Promise.resolve();
/** Runs library writes one at a time, each on the state the last one left. */
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

let stopWatching: (() => void) | null = null;

export function libraryActions(set: SetState, get: GetState) {
  const errorText = (e: unknown) =>
    e instanceof Error ? e.message : String(e);

  /** Saves `items` and only then shows them; a failed write changes nothing. */
  async function commit(items: LibraryItem[], seeded = get().librarySeeded) {
    const file: LibraryFile = { version: 1, seeded, items };
    try {
      await saveLibrary(file);
    } catch (e) {
      get().pushNotification({
        kind: "error",
        title: "Could not save your library",
        detail: errorText(e),
      });
      return false;
    }
    set({ library: items, librarySeeded: seeded });
    return true;
  }

  return {
    library: [] as LibraryItem[],
    librarySeeded: false,

    async loadLibrary() {
      let loaded;
      try {
        loaded = await apiLoadLibrary();
      } catch (e) {
        get().pushNotification({
          kind: "error",
          title: "Could not load your library",
          detail: errorText(e),
        });
        return;
      }
      const { file, recovered_backup } = loaded;
      set({ library: file.items, librarySeeded: file.seeded });
      if (recovered_backup !== null) {
        get().pushNotification({
          kind: "error",
          title: "Your library was reset",
          detail: WEB
            ? `It could not be read. A copy is kept in this browser's storage under ${recovered_backup}.`
            : `It could not be read. A copy is kept at ${recovered_backup}.`,
        });
      }
      if (!file.seeded) {
        await serial(() => commit(withStarters(file.items, Date.now()), true));
      }
      stopWatching ??= watchWebLibrary((next) =>
        set({ library: next.items, librarySeeded: next.seeded }),
      );
    },

    addLibraryItem(draft: LibraryDraft): Promise<LibraryResult> {
      return serial(async () => {
        const items = get().library;
        const check = checkDraft(draft, items);
        if (!check.ok) return check;
        const now = Date.now();
        const item: LibraryItem = {
          ...check.draft,
          id: crypto.randomUUID(),
          created_at: now,
          updated_at: now,
        };
        return (await commit([...items, item]))
          ? { ok: true as const, item }
          : { ok: false as const, field: null, message: "Not saved." };
      });
    },

    updateLibraryItem(id: string, draft: LibraryDraft): Promise<LibraryResult> {
      return serial(async () => {
        const items = get().library;
        const old = items.find((i) => i.id === id);
        if (!old)
          return {
            ok: false as const,
            field: null,
            message: "This item was deleted.",
          };
        const check = checkDraft(draft, items, id);
        if (!check.ok) return check;
        const item: LibraryItem = {
          ...old,
          ...check.draft,
          updated_at: Date.now(),
        };
        return (await commit(items.map((i) => (i.id === id ? item : i))))
          ? { ok: true as const, item }
          : { ok: false as const, field: null, message: "Not saved." };
      });
    },

    deleteLibraryItem(id: string): Promise<boolean> {
      return serial(() => commit(get().library.filter((i) => i.id !== id)));
    },

    /** Merges an export file's text into the library and reports the counts.
     *  Null when the file is not an export, leaving the library unchanged. */
    importLibrary(text: string): Promise<ImportSummary | null> {
      return serial(async () => {
        let incoming: unknown[] | null = null;
        try {
          incoming = parseExportFile(JSON.parse(text));
        } catch {
          // not JSON
        }
        if (!incoming) {
          get().pushNotification({
            kind: "error",
            title: "Could not import the library",
            detail: "The file is not a DH Studio library export.",
          });
          return null;
        }
        const { items, summary } = mergeImport(get().library, incoming);
        if (!(await commit(items))) return null;
        get().pushNotification({
          kind: "success",
          title: "Library imported",
          detail: summaryText(summary),
        });
        return summary;
      });
    },
  };
}
