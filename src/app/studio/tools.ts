import type { LucideIcon } from "lucide-react";
import { GitCompareArrows } from "lucide-react";
import { useStudioStore, type ToolId } from "@/shared/store";

export interface Tool {
  id: ToolId;
  label: string;
  icon: LucideIcon;
  /** Opens the tool in the given connection's workspace. */
  run: (conn_id: string) => void;
}

export const TOOLS: Tool[] = [
  {
    id: "compare",
    label: "Compare tables",
    icon: GitCompareArrows,
    run: (conn_id) => useStudioStore.getState().openCompare(conn_id),
  },
];
