import { WEB } from "@/shared/api/web";
import {
  updaterDownload,
  updaterInstallAndRestart,
} from "@/shared/api/updater";
import { useStudioStore } from "@/shared/store";

/** Checks GitHub Releases (via the `updater` plugin's configured endpoint —
 *  see `tauri.conf.json`'s `plugins.updater`) for a newer version. Never
 *  throws — offline, a GitHub rate-limit, or running in the web build are
 *  all just "no update found", matching `runStartupBootstrap`'s own
 *  never-block-never-crash convention. Stores the result in
 *  `useStudioStore` (`updateInfo`) so the title-bar badge and the update
 *  dialog can both read it without re-checking.
 *
 *  Does nothing while a known update is downloading, ready or installing:
 *  the running binary is unchanged until the restart, so a recheck would
 *  still report the same release and reset that progress. */
export async function checkForUpdate(): Promise<void> {
  if (WEB || is_busy()) return;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    const info = update
      ? { version: update.version, body: update.body ?? null }
      : null;
    // The frontend handle is only used to read the version and notes; the
    // download itself is Rust's (`updater_download`).
    await update?.close();
    // The user may have pressed Update while the check was in flight.
    if (is_busy()) return;
    useStudioStore.getState().setUpdateInfo(info);
  } catch {
    // Offline, rate-limited, malformed manifest, … — leave `updateInfo` as
    // it was; a failed check is not the same as "no update available".
  }
}

/** True when a known update is past "available" and a recheck must not
 *  touch it. */
function is_busy(): boolean {
  const { updateInfo, updatePhase } = useStudioStore.getState();
  return updateInfo !== null && updatePhase !== "available";
}

/** Downloads the known update into the backend. Never installs and never
 *  restarts. Lives here rather than in the dialog so closing the popup
 *  leaves the download running. Failures land in `updateError` with the
 *  phase back at "available" so the dialog can offer Retry. */
export async function downloadUpdate(): Promise<void> {
  const store = useStudioStore.getState();
  if (WEB || !store.updateInfo || store.updatePhase !== "available") return;
  store.setUpdatePhase("downloading");
  store.setUpdateError(null);
  store.setUpdateProgress(null);
  try {
    const held = await updaterDownload((event) => {
      const s = useStudioStore.getState();
      if (event.event === "Started") {
        s.setUpdateProgress({
          downloaded: 0,
          total: event.data.contentLength ?? null,
        });
      } else if (event.event === "Progress") {
        const p = s.updateProgress;
        s.setUpdateProgress({
          downloaded: (p?.downloaded ?? 0) + event.data.chunkLength,
          total: p?.total ?? null,
        });
      }
    });
    const done = useStudioStore.getState();
    // The package held may be a newer release than the one first seen.
    done.setUpdateInfo({ version: held.version, body: held.notes });
    done.setUpdateProgress(null);
    done.setUpdatePhase("ready");
  } catch (e) {
    const failed = useStudioStore.getState();
    failed.setUpdateProgress(null);
    failed.setUpdateError(String(e));
    failed.setUpdatePhase("available");
  }
}

/** Installs the downloaded update and relaunches into it. On success the
 *  process restarts, so nothing after the call normally runs. On failure the
 *  phase goes back to "ready" with the error, and connections stay open. */
export async function installAndRestart(): Promise<void> {
  const store = useStudioStore.getState();
  if (WEB || store.updatePhase !== "ready") return;
  store.setUpdatePhase("installing");
  store.setUpdateError(null);
  try {
    await updaterInstallAndRestart();
  } catch (e) {
    const failed = useStudioStore.getState();
    failed.setUpdateError(String(e));
    failed.setUpdatePhase("ready");
  }
}
