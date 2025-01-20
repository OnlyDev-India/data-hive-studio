"use client";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import customShortcuts from "./shortcuts.json";
import React from "react";
import { useRouter } from "next/navigation";
import { disconnectDb } from "@/lib/actions/fetch-data";
import { removeFile, resetOpenFiles } from "@/redux/features/open-files";
import { resetQuery } from "@/redux/features/query";
import { resetTables } from "@/redux/features/tables";
import { useDispatch, useSelector } from "react-redux";
import { FileType } from "@/types/file.type";
import { useMonaco } from "@monaco-editor/react";

const ShortCutProvider = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const dispatch = useDispatch();
  const monaco = useMonaco();
  const { shortcuts } = customShortcuts;
  const { currentFile }: { currentFile: FileType } = useSelector(
    (state: any) => state.openFiles,
  );
  const handleAction = (action: string) => {
    switch (action) {
      case "tablesView":
        router.push("/app/editor");
        break;
      case "visualizerView":
        router.push("/app/visualizer");
        break;
      case "disconnectDb":
        disconnectDb();
        dispatch(resetOpenFiles());
        dispatch(resetQuery());
        dispatch(resetTables());
        router.push("/");
        break;
      case "closeTab":
        if (currentFile?.id) {
          const currentModal = monaco.editor.getModel(
            `file:///${currentFile.id}`,
          );
          if (currentModal) currentModal.dispose();
          dispatch(removeFile({ id: currentFile.id }));
        }
        break;
      default:
        console.warn("Unknown action:", action);
    }
  };

  const shortcutHandlers = shortcuts?.map((shortcut) => ({
    keys: shortcut.keys,
    action: () => handleAction(shortcut.action),
  }));

  useKeyboardShortcuts(shortcutHandlers);
  return children;
};

export default ShortCutProvider;
