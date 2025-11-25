import { FileType } from "@/types/file.type";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

const initialState: {
  openFiles: FileType[];
  currentFile: FileType | null;
} = {
  openFiles: [],
  currentFile: null,
};

export const openFileSlice = createSlice({
  name: "openFiles",
  initialState,
  reducers: {
    resetOpenFiles: (state) => {
      state.openFiles = initialState.openFiles;
      state.currentFile = initialState.currentFile;
    },
    setCurrentFile: (state, action) => {
      state.currentFile = action.payload;
    },
    setOpenFiles: (state, action) => {
      state.openFiles = action.payload;
    },
    addOpenFiles: (
      state,
      action: PayloadAction<Omit<FileType["type"], "table" | "structure">>,
    ) => {
      const fileType = action.payload;
      const fileId: string = crypto.randomUUID();
      let newFile: FileType | null = null;
      switch (fileType) {
        case "file":
          const fileCount = state.openFiles.findLast(
            (file: any) =>
              file.type === "file" && file.name.startsWith("Query-"),
          );
          let lastNumber = 0;
          if (fileCount) {
            lastNumber = parseInt(fileCount.name.split("-")[1]);
          }
          const name = "Query-" + (lastNumber + 1).toString();
          newFile = {
            id: fileId,
            name,
            type: "file",
            code: "",
          };
          break;
        case "newTable":
          // TODO: add the data also here
          newFile = {
            id: crypto.randomUUID(),
            name: "New Table",
            type: "newTable",
          };
          break;
        case "visualizer":
          newFile = {
            id: crypto.randomUUID(),
            name: "New Visualizer",
            type: "visualizer",
          };
          break;
        case "settings":
          // Check if settings is already open
          const existingSettings = state.openFiles.find(
            (file: any) => file.type === "settings",
          );
          if (existingSettings) {
            state.currentFile = existingSettings;
            return;
          }
          newFile = {
            id: crypto.randomUUID(),
            name: "Settings",
            type: "settings",
          };
          break;
        default:
          break;
      }
      if (newFile) {
        state.openFiles.push(newFile);
        state.currentFile = newFile;
      }
    },
    updateFile: (state, action) => {
      const currentFile = state.currentFile;

      if (!currentFile) return;

      let index;
      if (action.payload.id) {
        index = state.openFiles.findIndex(
          (file: any) => file.id === action.payload.id.toString(),
        );
      } else {
        index = state.openFiles.findIndex(
          (file: any) => file.id === currentFile.id.toString(),
        );
      }
      if (
        !action.payload.id ||
        action.payload.id.toString() === currentFile.id.toString()
      ) {
        state.currentFile = { ...state.openFiles[index], ...action.payload };
      }
      state.openFiles[index] = { ...state.openFiles[index], ...action.payload };
    },
    removeFile: (state, action) => {
      const index = state.openFiles.findIndex(
        (file: any) => file.id === action.payload.id,
      );
      state.openFiles.splice(index, 1);
      if (state.currentFile?.id === action.payload.id) {
        if (index === 0 && state.openFiles.length > 0) {
          state.currentFile = state.openFiles[0];
        }
        if (index === 0 && state.openFiles.length === 0) {
          state.currentFile = null;
        }
        if (index > 0) {
          state.currentFile = state.openFiles[index - 1];
        }
      }
    },
    addTableFile: (state, action) => {
      const file = state.openFiles.find(
        (file: any) =>
          file.tableName === action.payload.table_name && file.type === "table",
      );
      if (file) {
        state.currentFile = file;
        return;
      }
      const newFile: FileType = {
        id: (state.openFiles.length + 1).toString(),
        name: action.payload.table_name,
        type: "table",
        tableData: { columns: [], rows: [], totalRecords: 0 },
        tableName: action.payload.table_name,
        tableFilter: action.payload.tableFilter || {
          filter: {
            oldFilter: [],
            newFilter: [],
          },
          applyFilter: false,
          filterOpened: false,
        },
        tableOrder: [],
        tablePagination: { page: 1, limit: 50 },
        tableOperations: {
          selectedRows: [],
          changedRows: {},
          insertedRows: 0,
        },
      };
      state.openFiles.push(newFile);
      state.currentFile = newFile;
    },
    addTableStructureFile: (state, action) => {
      const file = state.openFiles.find(
        (file: any) =>
          file.tableName === action.payload.table_name &&
          file.type === "structure",
      );
      if (file) {
        state.currentFile = file;
        return;
      }
      const newFile: FileType = {
        id: (state.openFiles.length + 1).toString(),
        name: action.payload.table_name,
        type: "structure",
        tableName: action.payload.table_name,
      };
      state.openFiles.push(newFile);
      state.currentFile = newFile;
    },
    rearrangeOpenFiles: (state, action) => {
      const { dragIndex, dropIndex } = action.payload;
      const dragFile = state.openFiles[dragIndex];
      state.openFiles.splice(dragIndex, 1);
      state.openFiles.splice(dropIndex, 0, dragFile);
    },
  },
});

export const {
  setCurrentFile,
  setOpenFiles,
  addOpenFiles,
  updateFile,
  removeFile,
  addTableFile,
  addTableStructureFile,
  resetOpenFiles,
  rearrangeOpenFiles,
} = openFileSlice.actions;

export default openFileSlice.reducer;
