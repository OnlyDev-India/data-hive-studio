"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  addTableFile,
  addTableStructureFile,
  addOpenFiles,
  addNewTableFile,
  setCurrentFile,
  removeFile,
} from "@/redux/features/open-files";
import { disconnectDb } from "@/lib/actions/fetch-data";
import { resetOpenFiles } from "@/redux/features/open-files";
import { resetQuery } from "@/redux/features/query";
import { resetTables } from "@/redux/features/tables";
import {
  TableIcon,
  DatabaseIcon,
  WaypointsIcon,
  PlusIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  HomeIcon,
  XIcon,
  PowerIcon,
  Grid2X2PlusIcon,
  PencilRulerIcon,
  CodeIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  startSearchValue: string;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  startSearchValue,
}: CommandPaletteProps) {
  const router = useRouter();
  const pathname = usePathname();
  const dispatch = useDispatch();
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  const { tables } = useSelector((state: any) => state.tables);
  const { openFiles, currentFile } = useSelector(
    (state: any) => state.openFiles,
  );

  const [searchValue, setSearchValue] = React.useState(startSearchValue);

  const paletteType = {
    isFile: !searchValue.startsWith(">"),
    isCommand: searchValue.startsWith(">"),
  };

  // Clear search when dialog opens/closes
  React.useEffect(() => {
    setSearchValue(startSearchValue);
  }, [startSearchValue]);

  // Highlight matching text in label
  function highlightMatch(label: string, query: string) {
    if (query.startsWith(">")) {
      query = query.slice(1);
    }
    query = query.trim();
    if (!query) return label;
    const regex = new RegExp(
      `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi",
    );
    return label.split(regex).map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="rounded bg-transparent p-0 text-[#40C9A2]">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  }

  const handleSelect = React.useCallback(
    (callback: () => void) => {
      callback();
      setSearchValue(">");
      onOpenChange(false);
    },
    [onOpenChange],
  );

  // --- Fix: Remove all useMemo for command arrays, always define them in the function body ---
  // 1. Define the full list (no .filter, no useMemo)
  const allNavigationCommands = [
    {
      id: "nav-home",
      label: "Go to Home",
      icon: HomeIcon,
      shortcut: "",
      action: () => router.push("/"),
      condition: pathname !== "/",
    },
    {
      id: "nav-editor",
      label: "Go to Editor",
      icon: DatabaseIcon,
      shortcut: "Ctrl+Shift+T",
      action: () => router.push("/app/editor"),
      condition: !pathname.includes("/app/editor"),
    },
    {
      id: "nav-visualizer",
      label: "Go to Schema Visualizer",
      icon: WaypointsIcon,
      shortcut: "Ctrl+Shift+V",
      action: () => router.push("/app/visualizer"),
      condition: !pathname.includes("/app/visualizer"),
    },
  ];

  const allFileCommands = [
    {
      id: "file-new-query",
      label: "New Query File",
      icon: PlusIcon,
      shortcut: "Ctrl+N",
      action: () => {
        dispatch(addOpenFiles());
        if (!pathname.includes("/app/editor")) {
          router.push("/app/editor");
        }
      },
      condition: true,
    },
    {
      id: "file-new-table",
      label: "Create New Table",
      icon: Grid2X2PlusIcon,
      shortcut: "",
      action: () => {
        dispatch(addNewTableFile());
        if (!pathname.includes("/app/editor")) {
          router.push("/app/editor");
        }
      },
      condition: true,
    },
  ];

  const allOpenFileCommands = openFiles.map((file: any) => ({
    id: `file-${file.id}`,
    label: `${file.name} ${file.type === "table" ? "Table" : file.type === "structure" ? "Structure" : file.type === "newTable" ? "New Table" : "Query"}`,
    icon:
      file.type === "table"
        ? TableIcon
        : file.type === "structure"
          ? PencilRulerIcon
          : file.type === "newTable"
            ? Grid2X2PlusIcon
            : CodeIcon,
    shortcut: "",
    action: () => dispatch(setCurrentFile(file)),
    isActive: currentFile?.id === file.id,
    condition: true,
  }));

  const allCloseFileCommands = openFiles.map((file: any) => ({
    id: `close-${file.id}`,
    label: `Close ${file.name}`,
    icon: XIcon,
    shortcut: file.id === currentFile?.id ? "Ctrl+W" : "",
    action: () => dispatch(removeFile({ id: file.id })),
    condition: true,
  }));

  const allTableCommands =
    tables
      ?.map((table: any) => [
        {
          id: `table-view-${table.table_name}`,
          label: `View Table: ${table.table_name}`,
          icon: TableIcon,
          shortcut: "",
          action: () => {
            dispatch(addTableFile({ table_name: table.table_name }));
            if (!pathname.includes("/app/editor")) {
              router.push("/app/editor");
            }
          },
          condition: true,
        },
        {
          id: `table-structure-${table.table_name}`,
          label: `View Structure: ${table.table_name}`,
          icon: PencilRulerIcon,
          shortcut: "",
          action: () => {
            dispatch(addTableStructureFile({ table_name: table.table_name }));
            if (!pathname.includes("/app/editor")) {
              router.push("/app/editor");
            }
          },
          condition: true,
        },
      ])
      .flat() || [];

  const allThemeCommands = [
    {
      id: "theme-light",
      label: "Switch to Light Theme",
      icon: SunIcon,
      shortcut: "",
      action: () => setTheme("light"),
      condition: theme !== "light",
    },
    {
      id: "theme-dark",
      label: "Switch to Dark Theme",
      icon: MoonIcon,
      shortcut: "",
      action: () => setTheme("dark"),
      condition: theme !== "dark",
    },
    {
      id: "theme-system",
      label: "Use System Theme",
      icon: MonitorIcon,
      shortcut: "",
      action: () => setTheme("system"),
      condition: theme !== "system",
    },
  ];

  const allQuickCommands = [
    {
      id: "quick-reload-tables",
      label: "Reload Tables",
      icon: DatabaseIcon,
      shortcut: "",
      action: () => {
        window.location.reload();
      },
      condition: pathname.startsWith("/app"),
    },
  ];

  const allSystemCommands = [
    {
      id: "system-disconnect",
      label: "Disconnect Database",
      icon: PowerIcon,
      shortcut: "Ctrl+Q",
      action: async () => {
        const response = await disconnectDb();
        if (response) {
          dispatch(resetOpenFiles());
          dispatch(resetQuery());
          dispatch(resetTables());
          router.push("/");
        }
      },
      condition: pathname.startsWith("/app"),
    },
  ];

  // 2. In filterCommands, filter by .condition and search
  const filterCommands = (commands: any[]) => {
    // Only include commands where .condition is true (or undefined)
    const available = commands.filter(
      (cmd) => cmd.condition === undefined || cmd.condition,
    );
    return available;
  };

  // 3. Use the full lists for filtering
  const filteredNavigationCommands = filterCommands(allNavigationCommands);
  const filteredFileCommands = filterCommands(allFileCommands);
  const filteredOpenFileCommands = filterCommands(allOpenFileCommands);
  const filteredCloseFileCommands = filterCommands(allCloseFileCommands);
  const filteredTableCommands = filterCommands(allTableCommands);
  const filteredQuickCommands = filterCommands(allQuickCommands);
  const filteredThemeCommands = filterCommands(allThemeCommands);
  const filteredSystemCommands = filterCommands(allSystemCommands);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      filter={(value, search) => {
        if (search.startsWith(">")) {
          const searchValue = search.slice(1).trim();
          return value.toLowerCase().includes(searchValue.toLowerCase())
            ? 1
            : 0;
        } else {
          return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
        }
      }}
      className={cn(
        "top-[2%] max-w-2xl translate-y-0",
        isDark && "bg-background/20",
      )}
      isCloseButton={false}
    >
      <CommandInput
        placeholder={
          paletteType.isFile
            ? "Search the Files, tables etc..."
            : "Type a command or search..."
        }
        className="!h-8 py-1"
        isIcon={false}
        value={searchValue}
        onValueChange={setSearchValue}
      />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>No commands found.</CommandEmpty>

        {searchValue.startsWith(">") ? (
          <>
            {filteredNavigationCommands.length > 0 && (
              <CommandGroup heading="Navigation">
                {filteredNavigationCommands.map((command) => (
                  <CommandItem
                    key={command.id}
                    onSelect={() => handleSelect(command.action)}
                  >
                    <command.icon className="mr-2 h-4 w-4 text-primary" />
                    <span>{highlightMatch(command.label, searchValue)}</span>
                    {command.shortcut && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {command.shortcut}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {filteredQuickCommands.length > 0 && (
              <>
                {filteredNavigationCommands.length > 0 && <CommandSeparator />}
                <CommandGroup heading="Quick Actions">
                  {filteredQuickCommands.map((command) => (
                    <CommandItem
                      key={command.id}
                      onSelect={() => handleSelect(command.action)}
                    >
                      <command.icon className="mr-2 h-4 w-4 text-primary" />
                      <span>{highlightMatch(command.label, searchValue)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {filteredThemeCommands.length > 0 && (
              <>
                {(filteredNavigationCommands.length > 0 ||
                  filteredQuickCommands.length > 0) && <CommandSeparator />}
                <CommandGroup heading="Theme">
                  {filteredThemeCommands.map((command) => (
                    <CommandItem
                      key={command.id}
                      onSelect={() => handleSelect(command.action)}
                    >
                      <command.icon className="mr-2 h-4 w-4 text-primary" />
                      <span>{highlightMatch(command.label, searchValue)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {filteredSystemCommands.length > 0 && (
              <>
                {(filteredNavigationCommands.length > 0 ||
                  filteredQuickCommands.length > 0 ||
                  filteredThemeCommands.length > 0) && <CommandSeparator />}
                <CommandGroup heading="System">
                  {filteredSystemCommands.map((command) => (
                    <CommandItem
                      key={command.id}
                      onSelect={() => handleSelect(command.action)}
                    >
                      <command.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>{highlightMatch(command.label, searchValue)}</span>
                      {command.shortcut && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {command.shortcut}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </>
        ) : (
          <>
            {filteredOpenFileCommands.length > 0 && (
              <>
                <CommandGroup heading="Open Files">
                  {filteredOpenFileCommands.map((command) => (
                    <CommandItem
                      key={command.id}
                      onSelect={() => handleSelect(command.action)}
                    >
                      <command.icon className="mr-2 h-4 w-4 text-primary" />
                      <span>{highlightMatch(command.label, searchValue)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {filteredTableCommands.length > 0 && (
              <>
                {filteredOpenFileCommands.length > 0 && <CommandSeparator />}
                <CommandGroup heading={`Tables (${tables?.length || 0})`}>
                  {filteredTableCommands.map((command) => (
                    <CommandItem
                      key={command.id}
                      onSelect={() => handleSelect(command.action)}
                    >
                      <command.icon className="mr-2 h-4 w-4 text-primary" />
                      <span>{highlightMatch(command.label, searchValue)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {filteredCloseFileCommands.length > 0 && (
              <>
                {filteredTableCommands.length > 0 && <CommandSeparator />}
                <CommandGroup heading="Close Files">
                  {filteredCloseFileCommands.map((command) => (
                    <CommandItem
                      key={command.id}
                      onSelect={() => handleSelect(command.action)}
                    >
                      <command.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>{highlightMatch(command.label, searchValue)}</span>
                      {command.shortcut && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {command.shortcut}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {filteredFileCommands.length > 0 && (
              <>
                {(filteredTableCommands.length > 0 ||
                  filteredCloseFileCommands.length > 0) && <CommandSeparator />}
                <CommandGroup heading="Files">
                  {filteredFileCommands.map((command) => (
                    <CommandItem
                      key={command.id}
                      onSelect={() => handleSelect(command.action)}
                    >
                      <command.icon className="mr-2 h-4 w-4 text-primary" />
                      <span className={command.isActive ? "font-semibold" : ""}>
                        {highlightMatch(command.label, searchValue)}
                      </span>
                      {command.isActive && (
                        <span className="ml-auto text-xs text-primary">●</span>
                      )}
                      {command.shortcut && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {command.shortcut}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
