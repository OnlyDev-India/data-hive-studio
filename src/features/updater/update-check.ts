import { WEB } from "@/shared/api/web";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { useStudioStore } from "@/shared/store";

// Module-level, not store state — the plugin's `Update` handle carries
// `.downloadAndInstall()` and isn't serializable, so it can't live in
// zustand. Same "singleton outside React" shape `use-tab-drag.ts` already
// uses for `suppress_next_click`.
let pending_update: Update | null = null;

/** Checks GitHub Releases (via the `updater` plugin's configured endpoint —
 *  see `tauri.conf.json`'s `plugins.updater`) for a newer version. Never
 *  throws — offline, a GitHub rate-limit, or running in the web build are
 *  all just "no update found", matching `runStartupBootstrap`'s own
 *  never-block-never-crash convention. Stores the result in
 *  `useStudioStore` (`updateInfo`) so the title-bar badge and the update
 *  dialog can both read it without re-checking. */
export async function checkForUpdate(): Promise<void> {
  if (WEB) return;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    pending_update = update;
    useStudioStore
      .getState()
      .setUpdateInfo(
        update ? { version: update.version, body: update.body ?? null } : null,
      );
  } catch {
    // Offline, rate-limited, malformed manifest, … — leave `updateInfo` as
    // it was; a failed check is not the same as "no update available".
  }
}

/** The `Update` handle from the most recent successful `checkForUpdate()`
 *  call, or null if none is pending (never checked, up to date, or the
 *  check failed). Used by the update dialog to actually download/install —
 *  never re-derived from `updateInfo` alone, since that's just the
 *  serializable summary. */
export function getPendingUpdate(): Update | null {
  return pending_update;
}

/** Downloads and installs the pending update, then relaunches into the new
 *  version. Throws on failure — the caller (the update dialog) is
 *  responsible for showing that to the user, unlike the silent
 *  background check. */
export async function downloadAndInstallUpdate(
  onProgress?: (event: DownloadEvent) => void,
): Promise<void> {
  if (!pending_update) throw new Error("No update to install");
  await pending_update.downloadAndInstall(onProgress);
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
