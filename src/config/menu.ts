import { CommandMenu } from "@/components/common/search-button";
import { DatabaseIcon, SearchIcon, WaypointsIcon } from "lucide-react";

export const sideBadMenu = [
  { icon: DatabaseIcon, title: "Table", link: "/app/editor" },
  { icon: SearchIcon, btn: CommandMenu, title: "Search" },
  { icon: WaypointsIcon, title: "Schema Visualizer", link: "/app/visualizer" },
];
