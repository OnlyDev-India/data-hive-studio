import { useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import type { StudioNotification } from "@/shared/store";
import { NotificationDetailDialog } from "./notification-detail-dialog";

const NOTIFICATION_ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} as const;

const NOTIFICATION_ICON_CLASS = {
  success: "text-success",
  error: "text-destructive",
  info: "text-sky-500",
} as const;

/** One notification row: kind icon, title, time, optional clamped detail with
 *  the full text on hover, and a hover-revealed dismiss button. */
export function NotificationItem({
  n,
  onDismiss,
}: {
  n: StudioNotification;
  onDismiss: () => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const Icon = NOTIFICATION_ICONS[n.kind];
  return (
    <>
      <div
        className={cn(
          "group hover:bg-muted/40 flex items-start gap-2 border-b px-3 py-2 last:border-b-0",
          !n.read && "bg-muted/20",
        )}
      >
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            NOTIFICATION_ICON_CLASS[n.kind],
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {!n.read && (
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-blue-500" />
            )}
            <span className="min-w-0 text-sm break-words">{n.title}</span>
            <span className="text-muted-foreground/70 ml-auto shrink-0 text-[10px]">
              {new Date(n.at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          {n.detail && (
            <div
              title={n.detail}
              className="text-muted-foreground mt-0.5 line-clamp-3 text-xs break-all whitespace-pre-wrap"
            >
              {n.detail}
            </div>
          )}
          {(n.actionLabel || n.description) && (
            <div className="mt-1 flex gap-1">
              {n.description && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[11px]"
                  onClick={() => setDetailOpen(true)}
                >
                  View details
                </Button>
              )}
              {n.actionLabel && n.actionFn && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[11px]"
                  onClick={n.actionFn}
                >
                  {n.actionLabel}
                </Button>
              )}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="iconXs"
          aria-label="Dismiss notification"
          title="Dismiss"
          className="opacity-0 transition-opacity group-hover:opacity-100"
          onClick={onDismiss}
        >
          <X className="size-3" />
        </Button>
      </div>
      {n.description && (
        <NotificationDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          notification={n}
        />
      )}
    </>
  );
}
