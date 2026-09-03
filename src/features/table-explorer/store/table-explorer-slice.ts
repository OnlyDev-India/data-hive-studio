import type { StoreApi } from "zustand";
import type { StudioStore } from "@/shared/store/types";

type SetState = StoreApi<StudioStore>["setState"];

/** Per-mongo-tab view mode ("grid" | "json"), keyed by the tab's unique key. */
export function tableExplorerActions(set: SetState) {
  return {
    mongoViews: {},
    setMongoView(key: string, view: "grid" | "json") {
      set((s) => ({
        mongoViews: { ...s.mongoViews, [key]: view },
      }));
    },
  };
}
