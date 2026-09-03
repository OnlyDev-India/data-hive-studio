import { useEffect } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { useStudioStore } from "@/shared/store";
import type { StudioNotification } from "@/shared/store";

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

export function NotificationDetailDialog({
  open,
  onOpenChange,
  notification,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notification: StudioNotification;
}) {
  const markRead = useStudioStore((s) => s.markRead);

  // Mark as read when dialog opens
  useEffect(() => {
    if (open && !notification.read) {
      markRead(notification.id);
    }
  }, [open, notification.read, notification.id, markRead]);

  const Icon = NOTIFICATION_ICONS[notification.kind];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon
              className={cn(
                "size-5 shrink-0",
                NOTIFICATION_ICON_CLASS[notification.kind],
              )}
            />
            {notification.title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {notification.detail && (
            <div className="bg-muted/50 text-muted-foreground rounded-md p-3 text-sm break-all whitespace-pre-wrap">
              {notification.detail}
            </div>
          )}
          {notification.description && (
            <div className="text-sm warp-break-words whitespace-pre-wrap">
              {notification.description}
            </div>
          )}
          <p className="text-muted-foreground/70 text-xs">
            {new Date(notification.at).toLocaleString()}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
