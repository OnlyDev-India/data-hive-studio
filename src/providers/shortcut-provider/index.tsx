"use client";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import customShortcuts from "./shortcuts.json";
import React from "react";
import { useRouter } from "next/navigation";
import { disconnectDb } from "@/lib/actions/fetch-data";
import { removeFile, resetOpenFiles, addOpenFiles } from "@/redux/features/open-files";
import { resetQuery } from "@/redux/features/query";
import { resetTables } from "@/redux/features/tables";
import { useDispatch, useSelector } from "react-redux";
import { FileType } from "@/types/file.type";
import { useMonaco } from "@monaco-editor/react";
import { CommandPalette } from "@/components/common/command-palette";
import { useAppData } from "@/hooks/useAppData";
import { closeAPIServer } from "@/features/custom-api/utils/data-thunk-func";
import { AppDispatch } from "@/redux/store";

const ShortCutProvider = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const monaco = useMonaco();
  const { shortcuts } = customShortcuts;
  const { currentFile }: { currentFile: FileType } = useSelector(
    (state: any) => state.openFiles,
  );
  const { connectionPath } = useAppData();
  
  // Command palette state
  const [commandPaletteOpen, setCommandPaletteOpen] = React.useState(false);
  const [startSearchValue, setStartSearchValue] = React.useState(">");
  
  // Listen for custom command palette trigger events
  React.useEffect(() => {
    const handleCommandPaletteTrigger = (event: CustomEvent) => {
      const { type = 'file' } = event.detail;
      setStartSearchValue(type === 'command' ? '>' : '');
      setCommandPaletteOpen(true);
    };

    document.addEventListener('command-palette-trigger', handleCommandPaletteTrigger as EventListener);

    return () => {
      document.removeEventListener('command-palette-trigger', handleCommandPaletteTrigger as EventListener);
    };
  }, []);

  const handleAction = async(action: string) => {
    switch (action) {
      case "tablesView":
        router.push("/app/editor");
        break;
      case "visualizerView":
        router.push("/app/visualizer");
        break;
      case "disconnectDb":
        await disconnectDb(connectionPath);
        dispatch(resetOpenFiles());
        dispatch(resetQuery());
        dispatch(resetTables());
        dispatch(closeAPIServer());
        router.push("/");
        break;
      case "closeTab":
        if (currentFile?.id) {
          const currentModal = monaco?.editor.getModel(
            monaco.Uri.parse(`file:///${currentFile.id}`),
          );
          if (currentModal) currentModal.dispose();
          dispatch(removeFile({ id: currentFile.id }));
        }
        break;
      case "commandPalette":
        setStartSearchValue(">");
        setCommandPaletteOpen(true);
        break;
      case "commandPaletteFile":
        setStartSearchValue("");
        setCommandPaletteOpen(true);
        break;
      case "newFile":
        dispatch(addOpenFiles());
        break;
      default:
        console.warn("Unknown action:", action);
    }
  };

  const shortcutHandlers = shortcuts?.map((shortcut) => ({
    keys: shortcut.keys,
    action: () => handleAction(shortcut.action),
  }));

  // Add command palette shortcut
  const allShortcuts = [
    ...shortcutHandlers,
  ];

  useKeyboardShortcuts(allShortcuts);
  
  return (
    <>
      {children}
      <CommandPalette 
        open={commandPaletteOpen} 
        onOpenChange={setCommandPaletteOpen}
        startSearchValue={startSearchValue}
      />
    </>
  );
};

export default ShortCutProvider;
