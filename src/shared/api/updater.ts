import { invoke, Channel } from "@tauri-apps/api/core";

/** Same shape as the updater plugin's own `DownloadEvent`. */
export type UpdateDownloadEvent =
  | { event: "Started"; data: { contentLength: number | null } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

/** The package now held in Rust: the version and notes found at download
 *  time, which can be newer than what the last background check saw. */
export interface DownloadedUpdate {
  version: string;
  notes: string | null;
}

/** Checks the endpoint again and downloads the package into the backend,
 *  reporting progress through `onEvent`. Never installs. */
export async function updaterDownload(
  onEvent: (event: UpdateDownloadEvent) => void,
): Promise<DownloadedUpdate> {
  const channel = new Channel<UpdateDownloadEvent>();
  channel.onmessage = onEvent;
  return invoke<DownloadedUpdate>("updater_download", { onEvent: channel });
}

/** Installs the downloaded package and relaunches into it. Resolves only
 *  when the install fails; on success the process restarts. */
export async function updaterInstallAndRestart(): Promise<void> {
  return invoke<void>("updater_install_and_restart");
}
