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
import { listUnappliedWork, useStudioStore } from "@/shared/store";
import {
  checkForUpdate,
  downloadUpdate,
  installAndRestart,
} from "./update-check";
import { ReleaseNotes } from "./release-notes";

type CheckState = "idle" | "checking" | "up-to-date";

/** The single update popup, mounted once as a singleton in `Studio` (same
 *  pattern as `DisconnectDialog`) — opened either by the title-bar badge
 *  (only clickable once a background check already found `updateInfo`) or
 *  the Help menu's "Check for Updates…" (an explicit ask that always
 *  deserves an answer, so this component itself runs a fresh check when it
 *  opens with nothing known yet, and can land on "You're up to date").
 *
 *  Where the update is (`updatePhase`, progress, error) lives in the store,
 *  not here, so closing the popup mid download changes nothing and reopening
 *  it from the badge lands on the right step. The popup only ever closes
 *  ("Later"); it never hides the badge. */
export function UpdateDialog() {
  const open = useStudioStore((s) => s.updateDialogOpen);
  const setOpen = useStudioStore((s) => s.setUpdateDialogOpen);
  const updateInfo = useStudioStore((s) => s.updateInfo);
  const phase = useStudioStore((s) => s.updatePhase);
  const progress = useStudioStore((s) => s.updateProgress);
  const error = useStudioStore((s) => s.updateError);

  const [check, setCheck] = useState<CheckState>("idle");
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  // Set when Restart now was pressed with unapplied edits open: the list of
  // what would be lost, shown for confirmation.
  const [unapplied, setUnapplied] = useState<
    { label: string; parts: string[] }[] | null
  >(null);

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
    setCheck("checking");
    void checkForUpdate().then(() => {
      setCheck(useStudioStore.getState().updateInfo ? "idle" : "up-to-date");
    });
  }, [open, updateInfo]);

  // Reset transient state on close so reopening later doesn't show a stale
  // check result or confirmation. The download itself is not touched.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on close
      setCheck("idle");
      setUnapplied(null);
    }
  }, [open]);

  function handle_restart() {
    const work = listUnappliedWork(useStudioStore.getState());
    if (work.length > 0) {
      setUnapplied(work);
      return;
    }
    void installAndRestart();
  }

  const confirming = unapplied !== null && phase === "ready";
  const installing = phase === "installing";
  const checking_or_upToDate = check === "checking" || check === "up-to-date";
  const percent = progress?.total
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : null;

  const title = confirming
    ? "Restart with unsaved changes?"
    : check === "checking"
      ? "Checking for updates…"
      : check === "up-to-date"
        ? "You're up to date"
        : phase === "downloading"
          ? "Downloading update"
          : phase === "ready"
            ? "Update ready to install"
            : phase === "installing"
              ? "Installing update…"
              : "Update available";

  const versions = updateInfo
    ? `Version ${updateInfo.version}${
        currentVersion ? ` (you have ${currentVersion})` : ""
      }`
    : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !installing && setOpen(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {check === "checking" && "Looking for a newer release…"}
            {check === "up-to-date" &&
              `DH Studio ${currentVersion ?? ""} is the latest version.`}
            {updateInfo &&
              !checking_or_upToDate &&
              (confirming
                ? "Restarting now will discard the changes below."
                : phase === "ready"
                  ? `${versions} is downloaded. Restart when you're ready; closing the app also installs it.`
                  : phase === "installing"
                    ? `Installing ${versions}. DH Studio will restart.`
                    : `${versions} is available.`)}
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <ul className="bg-muted/30 flex flex-col gap-1 rounded-md border p-3 text-sm">
            {unapplied.map((item, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-medium">
                  {item.label}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {item.parts.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          updateInfo?.body &&
          !checking_or_upToDate && (
            <div className="bg-muted/40 max-h-64 overflow-y-auto rounded-lg border p-3 text-sm">
              <ReleaseNotes markdown={updateInfo.body} />
            </div>
          )
        )}

        {phase === "downloading" && !checking_or_upToDate && (
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

        {error && !confirming && (
          <p className="text-destructive text-sm">{error}</p>
        )}

        <DialogFooter>
          {checking_or_upToDate ? (
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          ) : confirming ? (
            <>
              <Button variant="outline" onClick={() => setUnapplied(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void installAndRestart()}
              >
                Restart anyway
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={installing}
              >
                Later
              </Button>
              {(phase === "available" || phase === "downloading") && (
                <Button
                  onClick={() => void downloadUpdate()}
                  disabled={phase === "downloading"}
                >
                  {phase === "downloading"
                    ? "Downloading…"
                    : error
                      ? "Retry"
                      : "Update"}
                </Button>
              )}
              {(phase === "ready" || installing) && (
                <Button onClick={handle_restart} disabled={installing}>
                  {installing ? "Installing…" : error ? "Retry" : "Restart now"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
