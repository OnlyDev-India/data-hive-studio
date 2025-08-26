import { getConnections } from "@/lib/actions/app-data";
import { ConnectionsType } from "@/types/db.type";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

export const initAppData = createAsyncThunk(
  "tables/connectToAppDB",
  async (_, { rejectWithValue }) => {
    try {
      if (typeof window === "undefined" || !window.electron) {
        throw new Error("Electron environment not available.");
      }
      const dbPath = await window.electron.getConnectionsJsonPath();
      const response = await getConnections(dbPath);

      if (response.success && response.data) {
        return { connections: response.data.rows as ConnectionsType[] };
      } else {
        return rejectWithValue(response.error || "Failed to fetch connections.");
      }
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  },
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
          ({ id }) => id !== action.payload.id,
        );
        state.connections = remainingConnection;
      }
    },
    addOrUpdateConnection: (state, action) => {
      if (state.connections) {
        const index = state.connections.findIndex(
          ({ id }) => id === action.payload.id,
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
        // Optionally, you can store the error message in the state
        // state.connectionMessage = { success: false, error: action.payload as string };
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
