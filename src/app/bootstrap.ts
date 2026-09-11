import { WEB } from "@/shared/api/web";
import { bootstrapWorkspaceRestore, useStudioStore } from "@/shared/store";
import { checkForUpdate } from "@/features/updater";

const BOOTSTRAP_TIMEOUT_MS = 8_000;

async function openPendingFile(onStatus?: (s: string) => void): Promise<void> {
  if (WEB) return;
  const [{ invoke }, { openFileFromOs }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@/features/connections/lib/reopen"),
  ]);
  let path: string | null = null;
  try {
    path = await invoke<string | null>("take_pending_open_path");
  } catch {
    /* backend not ready yet — nothing to open */
  }
  if (!path) return;
  onStatus?.("Opening database…");
  await openFileFromOs(path);
}

/** Runs everything the splash screen covers: preload saved connections +
 *  persisted workspace state, and (desktop only) finish opening any
 *  `.db`/`.sqlite`/`.sqlite3` file the OS handed us at launch — so a
 *  double-clicked file is already open by the time the real UI paints,
 *  instead of flashing the Landing screen first. Never rejects — a timeout
 *  lifts the splash regardless, since a permanent splash would be a much
 *  worse regression than one that gave up early. */
export async function runStartupBootstrap(
  onStatus?: (s: string) => void,
): Promise<void> {
  // Prefetch the Studio chunk in parallel — its own lazy() import resolves
  // instantly once this is cached, so lifting the splash doesn't trade one
  // blank moment for another.
  void import("@/app/studio/studio");

  // Fire-and-forget: never awaited, never delays the splash. Whenever it
  // resolves (could be well after first paint), the title-bar badge/Help
  // menu just pick up `updateInfo` reactively.
  void checkForUpdate();

  const work = (async () => {
    await Promise.all([
      useStudioStore.getState().hydrateSavedLocal(),
      bootstrapWorkspaceRestore(),
    ]);
    await openPendingFile(onStatus);
  })();

  await Promise.race([
    work,
    new Promise<void>((resolve) => setTimeout(resolve, BOOTSTRAP_TIMEOUT_MS)),
  ]);
}
