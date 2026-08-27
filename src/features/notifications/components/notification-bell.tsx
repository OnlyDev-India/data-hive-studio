import { useCallback, useRef } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { useStudioStore } from "@/shared/store";
import { NotificationItem } from "./notification-item";

/**
 * Status-bar bell opening the notification center. Anything in the app can
 * push an entry via `pushNotification` (schema applies, exports, failures…);
 * the newest 50 are kept for the session. Each entry can be dismissed and
 * the whole list cleared.
 */
export function NotificationBell() {
  const items = useStudioStore((s) => s.notifications);
  const dismiss = useStudioStore((s) => s.dismissNotification);
  const markAllRead = useStudioStore((s) => s.markAllRead);
  const unreadCount = useStudioStore(
    (s) => s.notifications.filter((n) => !n.read).length,
  );
  const openRef = useRef(false);

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open && !openRef.current) {
        openRef.current = true;
        // Auto-mark all as read when popover opens
        markAllRead();
      } else if (!open) {
        openRef.current = false;
      }
    },
    [markAllRead],
  );

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="iconXs"
            aria-label={
              unreadCount > 0
                ? `Notifications (${unreadCount} unread)`
                : "Notifications"
            }
            title="Notifications"
            className="relative"
          >
            <Bell className="size-3.5" />
            {unreadCount > 0 && (
              <span className="bg-destructive absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full px-0.5 text-[9px] leading-none font-medium text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent sideOffset={12} align="end" className="w-80 p-0">
        <div className="flex h-8 items-center gap-2 border-b px-3">
          <span className="text-xs font-medium">Notifications</span>
          {items.length > 0 && (
            <>
              <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[10px]">
                {items.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground ml-auto h-5 px-1.5 text-[11px]"
                onClick={markAllRead}
                title="Mark all read"
              >
                <CheckCheck className="mr-1 size-3" />
                Mark all read
              </Button>
            </>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              No notifications
            </p>
          ) : (
            items.map((n) => (
              <NotificationItem
                key={n.id}
                n={n}
                onDismiss={() => dismiss(n.id)}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
