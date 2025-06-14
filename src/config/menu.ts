import { CommandMenu } from "@/components/common/search-button";
import { DatabaseIcon, SearchIcon, WaypointsIcon } from "lucide-react";

export const sideBadMenu = [
  {
    icon: DatabaseIcon,
    title: "Table",
    link: "/app/editor",
    shortcut: "Ctrl+Shift+T",
  },
  { icon: SearchIcon, btn: CommandMenu, title: "Command Palette", shortcut: "Ctrl+Shift+P" },
  {
    icon: WaypointsIcon,
    title: "Schema Visualizer",
    link: "/app/visualizer",
    shortcut: "Ctrl+Shift+V",
  },
];
