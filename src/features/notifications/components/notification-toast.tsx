import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { useStudioStore } from "@/shared/store";
import type { StudioNotification } from "@/shared/store";

const TOAST_ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} as const;

const TOAST_ICON_CLS = {
  success: "text-emerald-500",
  error: "text-destructive",
  info: "text-sky-500",
} as const;

/** Duration the toast is visible before it starts fading out (ms). */
const TOAST_LIVE_MS = 4000;
/** Duration of the exit animation (ms). */
const EXIT_ANIM_MS = 250;
/** Maximum toasts visible at once (oldest are removed first). */
const MAX_VISIBLE = 5;

/* -------------------------------------------------------------------------- */
/*  Single toast card                                                         */
/* -------------------------------------------------------------------------- */

function Toast({ n }: { n: StudioNotification }) {
  const dismissToast = useStudioStore((s) => s.dismissToast);
  const [mounted, setMounted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const gone = useRef(false);

  // Pop-in on mount (next frame so CSS transition fires)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Auto-dismiss after delay
  useEffect(() => {
    const t = setTimeout(() => {
      if (!gone.current) setExiting(true);
    }, TOAST_LIVE_MS);
    return () => clearTimeout(t);
  }, []);

  // After exit transition completes, remove from queue
  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(() => {
      if (!gone.current) {
        gone.current = true;
        dismissToast(n.id);
      }
    }, EXIT_ANIM_MS);
    return () => clearTimeout(t);
  }, [exiting, dismissToast, n.id]);

  const dismiss = () => {
    gone.current = true;
    dismissToast(n.id);
  };

  const Icon = TOAST_ICONS[n.kind];

  return (
    <div
      className={cn(
        "bg-background pointer-events-auto w-72 cursor-pointer rounded-lg border px-3 py-2.5 shadow-lg transition-all select-none",
        // exit — shrink toward bottom-right (bell) like macOS minimize
        exiting &&
          "translate-x-2 translate-y-1 scale-50 opacity-0 duration-300",
        // rest state (before mount or during exit)
        !mounted && "scale-90 opacity-0 duration-0",
        // entered
        mounted && !exiting && "scale-100 opacity-100 duration-200",
      )}
      style={{ transformOrigin: "bottom right" }}
      onClick={dismiss}
    >
      <div className="flex items-start gap-2">
        <Icon
          className={cn("mt-0.5 size-4 shrink-0", TOAST_ICON_CLS[n.kind])}
        />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium">{n.title}</span>
          {n.detail && (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs break-all whitespace-pre-wrap">
              {n.detail}
            </p>
          )}
          {n.actionLabel && n.actionFn && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-5 px-1.5 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                n.actionFn!();
              }}
            >
              {n.actionLabel}
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="iconXs"
          className="shrink-0 opacity-60 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            dismiss();
          }}
        >
          <X className="size-3" />
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Toast stack — rendered at the studio level, fixed bottom-right            */
/* -------------------------------------------------------------------------- */

export function NotificationToast() {
  const toasts = useStudioStore((s) => s.toastQueue);

  if (toasts.length === 0) return null;

  // Show at most MAX_VISIBLE; oldest trimmed first, newest sits at bottom
  // (closest to the bell icon).
  const visible = toasts.slice(-MAX_VISIBLE);

  return (
    <div className="pointer-events-none fixed right-4 bottom-10 z-50 flex flex-col-reverse gap-1.5">
      {visible.map((n) => (
        <Toast key={n.id} n={n} />
      ))}
    </div>
  );
}
