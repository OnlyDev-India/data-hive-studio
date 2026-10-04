import { invoke } from "@tauri-apps/api/core";
import { WEB } from "./web";
import { parseLibraryFile } from "../library/rules";
import type { LibraryFile } from "../library/types";

export const WEB_LIBRARY_KEY = "dh.web.library";
export const WEB_LIBRARY_BACKUP_KEY = "dh.web.library.bad";

export interface LibraryLoad {
  file: LibraryFile;
  /** Where the unreadable library was moved, when it was reset. */
  recovered_backup: string | null;
}

const emptyFile = (seeded: boolean): LibraryFile => ({
  version: 1,
  seeded,
  items: [],
});

function loadWeb(): LibraryLoad {
  const raw = localStorage.getItem(WEB_LIBRARY_KEY);
  if (raw === null) return { file: emptyFile(false), recovered_backup: null };
  let file: LibraryFile | null = null;
  try {
    file = parseLibraryFile(JSON.parse(raw));
  } catch {
    // not JSON: recovered below
  }
  if (file) return { file, recovered_backup: null };
  localStorage.setItem(WEB_LIBRARY_BACKUP_KEY, raw);
  const reset = emptyFile(true);
  localStorage.setItem(WEB_LIBRARY_KEY, JSON.stringify(reset));
  return { file: reset, recovered_backup: WEB_LIBRARY_BACKUP_KEY };
}

/** The stored library. A missing one is empty and unseeded; an unreadable one
 *  is backed up and comes back empty and seeded. */
export async function loadLibrary(): Promise<LibraryLoad> {
  if (WEB) return loadWeb();
  return invoke<LibraryLoad>("library_load");
}

/** Replaces the whole stored library. Throws when it could not be written. */
export async function saveLibrary(file: LibraryFile): Promise<void> {
  if (WEB) {
    localStorage.setItem(WEB_LIBRARY_KEY, JSON.stringify(file));
    return;
  }
  return invoke<void>("library_save", { file });
}

/** Web only: calls `onChange` with the library another tab just saved. */
export function watchWebLibrary(
  onChange: (file: LibraryFile) => void,
): () => void {
  if (!WEB) return () => {};
  const listener = (e: StorageEvent) => {
    if (e.key !== WEB_LIBRARY_KEY || e.newValue === null) return;
    try {
      const file = parseLibraryFile(JSON.parse(e.newValue));
      if (file) onChange(file);
    } catch {
      // a broken write from another tab is recovered on the next load
    }
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
