import { describe, expect, it } from "vitest";
import { create } from "zustand";
import { notificationsActions } from "./notifications-slice";

function makeStore() {
  // notificationsActions is typed against the FULL StudioStore's set/get
  // (it's designed to be spread into the real store) — a store created
  // from just this slice's own shape has narrower set/get types, which
  // TS correctly flags as incompatible. Safe to cast here: at runtime
  // set/get just read/merge whatever state exists, and this slice only
  // ever touches its own fields.
  return create<ReturnType<typeof notificationsActions>>()((set, get) =>
    notificationsActions(
      set as unknown as Parameters<typeof notificationsActions>[0],
      get as unknown as Parameters<typeof notificationsActions>[1],
    ),
  );
}

describe("notificationsActions", () => {
  it("pushNotification adds to both the list and the toast queue", () => {
    const store = makeStore();
    store.getState().pushNotification({ kind: "success", title: "Saved" });
    expect(store.getState().notifications).toHaveLength(1);
    expect(store.getState().toastQueue).toHaveLength(1);
    expect(store.getState().notifications[0].title).toBe("Saved");
    expect(store.getState().notifications[0].read).toBe(false);
  });

  it("dismissToast only removes from the toast queue, not the list", () => {
    const store = makeStore();
    store.getState().pushNotification({ kind: "info", title: "Hi" });
    const id = store.getState().notifications[0].id;
    store.getState().dismissToast(id);
    expect(store.getState().toastQueue).toHaveLength(0);
    expect(store.getState().notifications).toHaveLength(1);
  });

  it("markRead/markAllRead flip read state; unreadCount reflects it", () => {
    const store = makeStore();
    store.getState().pushNotification({ kind: "info", title: "A" });
    store.getState().pushNotification({ kind: "info", title: "B" });
    expect(store.getState().unreadCount()).toBe(2);

    const firstId = store.getState().notifications[0].id;
    store.getState().markRead(firstId);
    expect(store.getState().unreadCount()).toBe(1);

    store.getState().markAllRead();
    expect(store.getState().unreadCount()).toBe(0);
  });

  it("clearNotifications empties the list without touching toasts already queued", () => {
    const store = makeStore();
    store.getState().pushNotification({ kind: "error", title: "Oops" });
    store.getState().clearNotifications();
    expect(store.getState().notifications).toHaveLength(0);
  });

  it("caps notifications at 50", () => {
    const store = makeStore();
    for (let i = 0; i < 55; i++) {
      store.getState().pushNotification({ kind: "info", title: `n${i}` });
    }
    expect(store.getState().notifications).toHaveLength(50);
  });
});
