import { Action, configureStore, ThunkAction } from "@reduxjs/toolkit";
import openFileSlice from "./features/open-files";
import querySlice from "./features/query";
import tablesSlice from "./features/tables";
import appDBSlice from "./features/appdb";
import backgroundProcessesSlice from "./features/background-processes";
import tasksSlice from "./features/tasks";
import apiSlice from "../features/custom-api/redux/api";
import workbenchSlice from "../features/custom-api/redux/workbench";

const store = configureStore({
  reducer: {
    openFiles: openFileSlice,
    query: querySlice,
    tables: tablesSlice,
    appDB: appDBSlice,
    bgProcesses: backgroundProcessesSlice,
    tasks: tasksSlice,
    api: apiSlice,
    workbench: workbenchSlice,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export type AppDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;
export type AppThunk<ReturnType = void> = ThunkAction<
  ReturnType,
  RootState,
  unknown,
  Action<string>
>;

export default store;
