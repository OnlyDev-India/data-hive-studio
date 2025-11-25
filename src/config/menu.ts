import { CommandMenu } from "@/components/common/search-button";
import { DatabaseIcon, HistoryIcon, SearchIcon } from "lucide-react";

type SideBadMenuType = {
  icon: React.ElementType;
  btn?: React.ElementType;
  title: string;
  link?: string;
  shortcut?: string;
  saveId?: string;
  disabled?: boolean;
  sidebar?: string;
};

export const sideBadMenu: SideBadMenuType[] = [
  {
    icon: DatabaseIcon,
    title: "Table",
    link: "/app/editor",
    shortcut: "Ctrl+Shift+T",
    saveId: "editor-sidebar",
    sidebar: "default",
  },
  {
    icon: SearchIcon,
    btn: CommandMenu,
    title: "Command Palette",
    shortcut: "Ctrl+Shift+P",
  },
  {
    icon: HistoryIcon,
    title: "History",
    link: "/app/editor?sidebar=history",
    shortcut: "Ctrl+Shift+H",
    saveId: "editor-sidebar",
    sidebar: "history",
  },
];
