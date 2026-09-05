import { invoke } from "@tauri-apps/api/core";
import { WEB } from "./web";

/** Load the last-saved workspace snapshot (whatever shape the store last
 *  saved — see `shared/store/workspace-persistence.ts`), or `null` if
 *  there's nothing saved yet. No-op in WEB mode (no local filesystem). */
export async function loadWorkspaceState(): Promise<unknown> {
  if (WEB) return null;
  return invoke<unknown>("load_workspace_state");
}

/** Overwrite the saved snapshot — always the full current state, never a
 *  partial merge. No-op in WEB mode. */
export async function saveWorkspaceState(state: unknown): Promise<void> {
  if (WEB) return;
  return invoke<void>("save_workspace_state", { state });
}

/** Forget the saved snapshot entirely. No-op in WEB mode. */
export async function clearWorkspaceState(): Promise<void> {
  if (WEB) return;
  return invoke<void>("clear_workspace_state");
}
