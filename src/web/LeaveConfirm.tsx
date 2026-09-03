import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { CornerDownLeft, Earth } from "lucide-react";

import { Button } from "@/shared/components/ui/button";

/**
 * In-app replacement for the browser's native beforeunload popup (web mode).
 * Shown when the user attempts to reload while connected to server sessions.
 * Browsers cannot render custom UI for tab/window close — that path stays
 * silent; this covers everything the app can intercept.
 */
export function LeaveConfirm({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 z-100 bg-black/50" />
        <DialogPrimitive.Popup className="bg-background ring-1/10 ring-ring/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 fixed top-[50%] left-[50%] z-100 w-[min(560px,calc(100vw-2rem))] translate-x-[-50%] translate-y-[-50%] rounded-2xl border p-6 shadow-xl duration-200">
          <DialogPrimitive.Title className="flex items-center gap-2.5 text-base font-semibold">
            <Earth className="size-5 shrink-0" strokeWidth={1.75} />
            {window.location.host}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-foreground mt-4 text-[15px] leading-relaxed">
            This page is asking you to confirm that you want to leave —
            information you&rsquo;ve entered may not be saved.
          </DialogPrimitive.Description>
          <div className="mt-7 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                window.location.reload();
              }}
            >
              Leave page
              <CornerDownLeft className="size-4" strokeWidth={1.75} />
            </Button>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Stay on page
              <kbd className="bg-muted text-muted-foreground ml-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium">
                ESC
              </kbd>
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
