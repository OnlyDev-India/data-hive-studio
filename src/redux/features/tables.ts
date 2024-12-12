import { getTablesWithFieldsFromDb } from "@/lib/actions/fetch-data";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

export const fetchTables = createAsyncThunk("tables/fetchTables", async () => {
  const tables = await getTablesWithFieldsFromDb();
  
  return tables;
});

const initialState = {
  tables: null as any | null,
  loading: false,
}

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
  },
  extraReducers: (builder) => {
      
      builder
      .addCase(fetchTables.pending, (state) => {
        state.loading = true; // Set loading to true when fetching starts
      })
      .addCase(fetchTables.fulfilled, (state, action) => {
        state.loading = false; // Set loading to false when fetching is done
        state.tables = action.payload; // Store fetched tables
      })
      .addCase(fetchTables.rejected, (state, action) => {
        state.loading = false; // Set loading to false on error
      });
  },
});

export const { setTables, resetTables } = tablesSlice.actions;

export default tablesSlice.reducer;
