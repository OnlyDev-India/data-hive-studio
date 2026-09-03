import type { StoreApi } from "zustand";
import type { StudioNotification, StudioStore } from "@/shared/store/types";

type SetState = StoreApi<StudioStore>["setState"];
type GetState = StoreApi<StudioStore>["getState"];

let notif_seq = 0;

/** Generic notification center (action-bar bell) plus the floating toast
 *  queue. Any feature can push a notification — e.g. applied schema
 *  changes, export results, failed operations. Newest first, capped,
 *  session-only. */
export function notificationsActions(set: SetState, get: GetState) {
  return {
    // Explicit types (not just `[]`, which TS infers as `never[]`) so this
    // slice's own return type is correct standalone — matters for testing
    // it in isolation (see notifications-slice.test.ts).
    notifications: [] as StudioNotification[],
    toastQueue: [] as StudioNotification[],
    pushNotification(n: {
      kind: StudioNotification["kind"];
      title: string;
      detail?: string;
      actionLabel?: string;
      actionFn?: () => void;
      description?: string;
    }) {
      const item = {
        id: `n${Date.now()}-${++notif_seq}`,
        at: Date.now(),
        read: false,
        ...n,
      };
      set((s) => ({
        notifications: [item, ...s.notifications].slice(0, 50),
        toastQueue: [...s.toastQueue, item],
      }));
    },
    dismissNotification(id: string) {
      set((s) => ({
        notifications: s.notifications.filter((x) => x.id !== id),
      }));
    },
    clearNotifications() {
      set({ notifications: [] });
    },
    markRead(id: string) {
      set((s) => ({
        notifications: s.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n,
        ),
      }));
    },
    markAllRead() {
      set((s) => ({
        notifications: s.notifications.map((n) => ({ ...n, read: true })),
      }));
    },
    unreadCount() {
      return get().notifications.filter(
        (n: StudioNotification) => !n.read,
      ).length;
    },
    dismissToast(id: string) {
      set((s) => ({ toastQueue: s.toastQueue.filter((x) => x.id !== id) }));
    },
  };
}
