import type { StoreApi } from "zustand";
import type { StudioStore } from "@/shared/store/types";

type SetState = StoreApi<StudioStore>["setState"];

/** Live feed of backend commands (Activity sidebar). Fed by the
 *  `activity://entry` Tauri event; newest first, capped, session-only. */
export function activityActions(set: SetState) {
  return {
    activityOpen: false,
    toggleActivityOpen() {
      set((s) => ({ activityOpen: !s.activityOpen }));
    },
    setActivityOpen(open: boolean) {
      set({ activityOpen: open });
    },
    // Backend caps the ring buffer at 500; the store mirrors that bound.
    // Explicit type (not just `[]`, which TS infers as `never[]`) so this
    // slice's own return type is correct standalone, not just when spread
    // into `create<StudioStore>()` where contextual typing papers over it —
    // matters for testing the slice in isolation (see activity-slice.test.ts).
    activity: [] as StudioStore["activity"],
    pushActivity(entry: StudioStore["activity"][number]) {
      // Idempotent by id: a duplicated Tauri event (leaked listener, dev
      // remount) must never render the same command twice — identical ids
      // were also the "multiple selected rows" bug.
      set((s) =>
        s.activity.some((e) => e.id === entry.id)
          ? s
          : { activity: [entry, ...s.activity].slice(0, 500) },
      );
    },
    // Hydration merge: snapshot entries that were ALSO delivered live are
    // skipped (same id); live entries pushed before hydration finished are
    // newer than anything in the snapshot and stay on top.
    setActivity(entries: StudioStore["activity"]) {
      set((s) => {
        const snap_ids = new Set(entries.map((e) => e.id));
        const live_only = s.activity.filter((e) => !snap_ids.has(e.id));
        return { activity: [...live_only, ...entries].slice(0, 500) };
      });
    },
    clearActivityEntries() {
      set({ activity: [] });
    },
    activityDetail: null,
    setActivityDetail(detail: StudioStore["activityDetail"]) {
      set({ activityDetail: detail });
    },
  };
}
