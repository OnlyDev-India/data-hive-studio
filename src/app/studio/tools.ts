import type { LucideIcon } from "lucide-react";
import { GitCompareArrows, Network } from "lucide-react";
import { getActiveSchema } from "@/shared/api";
import { useStudioStore, type ToolId } from "@/shared/store";

export interface Tool {
  id: ToolId;
  label: string;
  icon: LucideIcon;
  /** Opens the tool in the given connection's workspace. */
  run: (conn_id: string) => void;
}

/** The relation diagram of the connection's current database and schema: the
 *  active schema on Postgres, the active database on Mongo, the whole file
 *  on SQLite. */
export async function openActiveRelationDiagram(
  conn_id: string,
): Promise<void> {
  const s = useStudioStore.getState();
  const conn = s.open.find((c) => c.id === conn_id);
  if (!conn) return;
  if (conn.kind === "sqlite") return s.openRelationDiagram(conn_id);
  try {
    const active = await getActiveSchema(conn_id);
    s.openRelationDiagram(
      conn_id,
      conn.kind === "mongodb" ? { database: active } : { schema: active },
    );
  } catch (e) {
    s.pushNotification({
      kind: "error",
      title: "Couldn't open the relation diagram",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

export const TOOLS: Tool[] = [
  {
    id: "compare",
    label: "Compare tables",
    icon: GitCompareArrows,
    run: (conn_id) => useStudioStore.getState().openCompare(conn_id),
  },
  {
    id: "relation-diagram",
    label: "Relation diagram",
    icon: Network,
    run: (conn_id) => void openActiveRelationDiagram(conn_id),
  },
];
