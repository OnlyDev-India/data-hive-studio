import type { XY } from "@/shared/components/relation-canvas";
import { useStudioStore } from "@/shared/store";

type Positions = Record<string, XY>;

/** One schema diagram's saved box positions; null until a box is dragged.
 *  Lives in the store's `relationLayouts`, filed with the connection's tabs. */
export function useSavedLayout(
  conn_id: string,
  database: string | undefined,
  schema: string | undefined,
) {
  const key = `${database ?? ""}|${schema ?? ""}`;
  const saved = useStudioStore(
    (s) => s.relationLayouts[conn_id]?.[key] ?? null,
  );
  const set = useStudioStore((s) => s.setRelationLayout);
  return {
    saved,
    save: (p: Positions) => set(conn_id, key, p),
    reset: () => set(conn_id, key, null),
  };
}
