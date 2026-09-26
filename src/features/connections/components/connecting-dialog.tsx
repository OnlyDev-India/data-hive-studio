import { useEffect, useState } from "react";
import type { SavedDbKind } from "@/shared/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui";
import { cn } from "@/shared/lib/utils";
import { kindItem } from "./connection-form/kinds";

export interface ConnectingTarget {
  name: string;
  kind: SavedDbKind;
  /** Host and port, or the file path. */
  where: string;
  /** Connected: the bar fills before the workspace opens. */
  done?: boolean;
}

/** How long the full bar shows before the workspace opens. */
export const CONNECTED_HOLD_MS = 350;

/** The backend reports no progress, so the bar eases toward 90% while waiting. */
function ProgressBar({ done }: { done: boolean }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setStarted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      role="progressbar"
      aria-label="Connecting"
      aria-valuenow={done ? 100 : undefined}
      className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
    >
      <div
        className={cn(
          "bg-primary h-full rounded-full transition-[width] ease-out",
          done ? "duration-300" : "duration-[8000ms]",
        )}
        style={{ width: done ? "100%" : started ? "90%" : "4%" }}
      />
    </div>
  );
}

export function ConnectingDialog({
  target,
}: {
  target: ConnectingTarget | null;
}) {
  const item = target ? kindItem(target.kind) : null;
  return (
    <Dialog open={target !== null}>
      <DialogContent className="sm:max-w-sm" hideCloseButton>
        {target && item && (
          <>
            <DialogHeader className="flex-row items-center gap-3">
              <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
                <item.icon aria-hidden className="size-6" />
              </span>
              <div className="grid min-w-0 gap-0.5">
                <DialogTitle className="truncate">
                  {target.done ? "Connected to" : "Connecting to"} {target.name}
                </DialogTitle>
                <DialogDescription className="truncate font-mono text-xs">
                  {target.where}
                </DialogDescription>
              </div>
            </DialogHeader>
            <ProgressBar done={!!target.done} />
            <p className="text-muted-foreground text-xs">
              {target.done
                ? "Opening the workspace…"
                : "A remote server can take a few seconds."}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
