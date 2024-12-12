import { Action, configureStore, ThunkAction } from "@reduxjs/toolkit";
import openFileSlice from "./features/open-files";
import querySlice from "./features/query";
import editorSlice from "./features/editor";
import tablesSlice from "./features/tables";
import appDBSlice from "./features/appdb";

const store = configureStore({
  reducer: {
    openFiles: openFileSlice,
    query: querySlice,
    tables: tablesSlice,
    editor: editorSlice,
    appDB: appDBSlice,
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
