import { getTablesWithFieldsFromDb } from "@/lib/actions/fetch-data";
import {
  AsyncThunkOptions,
  AsyncThunkPayloadCreator,
  createAsyncThunk,
  createSlice,
} from "@reduxjs/toolkit";

export const fetchAllTables = createAsyncThunk(
  "tables/fetchAllTables",
  async (args: boolean, { getState }) => {
    // Access the current schema from the state
    const state: any = getState();

    const currentSchema = state.tables.currentSchema;
    const { tables } = await getTablesWithFieldsFromDb(currentSchema, args);

    return tables;
  },
);

export const fetchTables =
  (isUpdateSchema = false) =>
  async (dispatch: any, payloadCreator: any, options?: any | undefined) => {
    fetchAllTables(isUpdateSchema)(dispatch, payloadCreator, options);
  };

const initialState = {
  tables: null as any | null,
  loading: null as string | null,
  currentSchema: "public",
};

export const tablesSlice = createSlice({
  name: "tables",
  initialState,
  reducers: {
    resetTables: (state) => {
      state.tables = initialState.tables;
      state.loading = initialState.loading;
    },
    setTables: (state, action) => {
      state.tables = action.payload;
    },
    setCurrentSchema: (state, action) => {
      state.currentSchema = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAllTables.pending, (state) => {
        state.loading = "fetching"; // Set loading to true when fetching starts
      })
      .addCase(fetchAllTables.fulfilled, (state, action) => {
        state.loading = null; // Set loading to false when fetching is done
        state.tables = action.payload; // Store fetched tables
      })
      .addCase(fetchAllTables.rejected, (state, action) => {
        state.loading = "fetching"; // Set loading to false on error
      });
  },
});

export const { setTables, resetTables, setCurrentSchema } = tablesSlice.actions;

export default tablesSlice.reducer;
