import { CommandMenu } from "@/components/common/search-button";
import {
  DatabaseIcon,
  SearchIcon,
  Share2Icon,
  WaypointsIcon,
} from "lucide-react";

type SideBadMenuType = {
  icon: React.ElementType;
  btn?: React.ElementType;
  title: string;
  link?: string;
  shortcut?: string;
  saveId?: string;
  disabled?: boolean;
};

export const sideBadMenu: SideBadMenuType[] = [
  {
    icon: DatabaseIcon,
    title: "Table",
    link: "/app/editor",
    shortcut: "Ctrl+Shift+T",
    saveId: "editor-sidebar",
  },
  {
    icon: SearchIcon,
    btn: CommandMenu,
    title: "Command Palette",
    shortcut: "Ctrl+Shift+P",
  },
  {
    icon: WaypointsIcon,
    title: "Schema Visualizer",
    link: "/app/visualizer",
    shortcut: "Ctrl+Shift+V",
    saveId: "editor-sidebar",
  },
  {
    icon: Share2Icon,
    title: "Custom API",
    link: "/app/custom-api",
    shortcut: "Ctrl+Shift+C",
    saveId: "editor-sidebar",
  },
];
