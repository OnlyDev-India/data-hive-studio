import { deleteConnection, getConnections } from "@/lib/actions/app-data";
import { ConnectionsType } from "@/types/db.type";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

export const initAppData = createAsyncThunk(
  "tables/connectToAppDB",
  async () => {
    // const tables = await getTablesWithFieldsFromDb();
    
    const {
      data: { rows: connections },
    } = await getConnections();
    if (connections) return { connections };
    return { connections: null };
  }
);

const initialState: {
  connections: ConnectionsType[] | null;
  currentConnection: ConnectionsType | null;
  connectionMessage: { success: boolean; error: string | null } | null;
  loading: boolean;
} = {
  connections: null,
  currentConnection: null,
  connectionMessage: null,
  loading: false,
};
export const appDBSlice = createSlice({
  name: "App-DB",
  initialState,
  reducers: {
    resetAppDB: (state) => {
      state = initialState;
    },
    setAppDB: (state, action) => {
      state.connections = action.payload;
    },
    setCurrentConnection: (state, action) => {
      state.currentConnection = action.payload;
    },
    removeConnection: (state, action) => {
      if (state.connections) {
        const remainingConnection = state.connections.filter(
          ({ id }) => id !== action.payload.id
        );
        state.connections = remainingConnection;
      }
    },
    addOrUpdateConnection: (state, action) => {
      if (state.connections) {
        const index = state.connections.findIndex(
          ({ id }) => id === action.payload.id
        );
        if (index !== -1) {
          // Update existing connection
          state.connections[index] = action.payload;
        } else {
          // Add new connection
          state.connections.push(action.payload);
        }
      } else {
        state.connections = [action.payload];
      }
    },
    setConnectionLoading: (state, action) => {
      state.loading = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initAppData.pending, (state) => {
        state.loading = true; // Set loading to true when fetching starts
      })
      .addCase(initAppData.fulfilled, (state, action) => {
        state.loading = false; // Set loading to false when fetching is done
        state.connections = action.payload.connections;
      })
      .addCase(initAppData.rejected, (state, action) => {
        state.loading = false; // Set loading to false on error
      });
  },
});

export const {
  setAppDB,
  resetAppDB,
  setCurrentConnection,
  removeConnection,
  addOrUpdateConnection,
  setConnectionLoading,
} = appDBSlice.actions;

export default appDBSlice.reducer;
