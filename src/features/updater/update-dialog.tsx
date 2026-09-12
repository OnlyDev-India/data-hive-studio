import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui";
import { cn } from "@/shared/lib/utils";
import { useStudioStore } from "@/shared/store";
import { checkForUpdate, downloadAndInstallUpdate } from "./update-check";

type Phase = "idle" | "checking" | "up-to-date" | "downloading" | "error";

/** The single update popup, mounted once as a singleton in `Studio` (same
 *  pattern as `DisconnectDialog`) — opened either by the title-bar badge
 *  (only clickable once a background check already found `updateInfo`) or
 *  the Help menu's "Check for Updates…" (an explicit ask that always
 *  deserves an answer, so this component itself runs a fresh check when it
 *  opens with nothing known yet, and can land on "You're up to date"). */
export function UpdateDialog() {
  const open = useStudioStore((s) => s.updateDialogOpen);
  const setOpen = useStudioStore((s) => s.setUpdateDialogOpen);
  const updateInfo = useStudioStore((s) => s.updateInfo);
  const setSkippedUpdateVersion = useStudioStore(
    (s) => s.setSkippedUpdateVersion,
  );

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{
    downloaded: number;
    total: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setCurrentVersion)
      .catch(() => {});
  }, [open]);

  // Help-menu path: opened with no `updateInfo` yet — the title-bar badge
  // never opens this without one already set, so this only ever fires for
  // an explicit on-demand check.
  useEffect(() => {
    if (!open || updateInfo) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- claims the on-demand check synchronously; the real work is already async in .then()
    setPhase("checking");
    void checkForUpdate().then(() => {
      setPhase(useStudioStore.getState().updateInfo ? "idle" : "up-to-date");
    });
  }, [open, updateInfo]);

  // Reset transient state on close so reopening later doesn't show stale
  // progress/errors from a previous attempt.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on close
      setPhase("idle");
      setProgress(null);
      setError(null);
    }
  }, [open]);

  function handle_skip() {
    if (updateInfo) setSkippedUpdateVersion(updateInfo.version);
    setOpen(false);
  }

  async function handle_update() {
    setPhase("downloading");
    setError(null);
    try {
      await downloadAndInstallUpdate((event) => {
        if (event.event === "Started") {
          setProgress({
            downloaded: 0,
            total: event.data.contentLength ?? null,
          });
        } else if (event.event === "Progress") {
          setProgress((p) => ({
            downloaded: (p?.downloaded ?? 0) + event.data.chunkLength,
            total: p?.total ?? null,
          }));
        }
      });
      // `downloadAndInstallUpdate` relaunches on success — nothing after
      // this normally runs.
    } catch (e) {
      setPhase("error");
      setError(String(e));
    }
  }

  const downloading = phase === "downloading";
  const checking_or_upToDate = phase === "checking" || phase === "up-to-date";
  const percent = progress?.total
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !downloading && setOpen(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {phase === "checking"
              ? "Checking for updates…"
              : phase === "up-to-date"
                ? "You're up to date"
                : "Update available"}
          </DialogTitle>
          <DialogDescription>
            {phase === "checking" && "Looking for a newer release…"}
            {phase === "up-to-date" &&
              `DH Studio ${currentVersion ?? ""} is the latest version.`}
            {updateInfo &&
              !checking_or_upToDate &&
              `Version ${updateInfo.version} is available${
                currentVersion ? ` (you have ${currentVersion})` : ""
              }.`}
          </DialogDescription>
        </DialogHeader>

        {updateInfo?.body && !checking_or_upToDate && (
          <div className="bg-muted/40 max-h-64 overflow-y-auto rounded-lg border p-3 text-sm whitespace-pre-wrap">
            {updateInfo.body}
          </div>
        )}

        {downloading && (
          <div className="flex flex-col gap-1.5">
            <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <div
                className={cn(
                  "bg-primary h-full",
                  percent === null ? "w-full animate-pulse" : "transition-all",
                )}
                style={percent !== null ? { width: `${percent}%` } : undefined}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              {percent !== null ? `${percent}%` : "Downloading…"}
            </p>
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}

        <DialogFooter>
          {checking_or_upToDate ? (
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handle_skip}
                disabled={downloading}
              >
                Skip
              </Button>
              <Button
                onClick={() => void handle_update()}
                disabled={downloading}
              >
                {downloading ? "Updating…" : "Update & Restart"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
