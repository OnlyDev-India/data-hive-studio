import { getConnections } from "@/lib/actions/app-data";
import { ConnectionDetailsType, ConnectionsType } from "@/types/db.type";
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { LocalAppStorePath } from "@/config/local-app-store-path";
import { getConnectionDetails } from "@/lib/actions/fetch-data";
export const initAppData = createAsyncThunk(
  "tables/connectToAppDB",
  async (_, { rejectWithValue }) => {
    try {
      if (typeof window === "undefined" || !window.electron) {
        const connections = localStorage.getItem("connections");
        if (connections) {
          return { connections: JSON.parse(connections) as ConnectionsType[] };
        } else {
          return rejectWithValue("No connections found.");
        }
      }
      const dbPath =
        (await window.electron.getConnectionsJsonPath()) +
        LocalAppStorePath.connectionsJsonPath;
      const response = await getConnections(dbPath);

      if (response.success && response.data) {
        // Initialize API details after connections are loaded
        return { connections: response.data.rows as ConnectionsType[] };
      } else {
        return rejectWithValue(
          response.error || "Failed to fetch connections.",
        );
      }
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  },
);

export const initConnectedConnection = createAsyncThunk(
  "tables/initConnectedConnection",
  async (_, { rejectWithValue, dispatch }) => {
    try {
      const response: any = await dispatch(initAppData());
      let connections: ConnectionsType[] | null = null;
      if (!response.error && response.payload) {
        connections = response.payload.connections;
        dispatch(setConnections(connections));
      } else {
        return rejectWithValue(response.payload);
      }

      if (!connections) {
        return rejectWithValue("No connections found.");
      }

      const { connectionDetails } = await getConnectionDetails();
      if (!connectionDetails) {
        return rejectWithValue("No connections found.");
      }
      const connection = connections.find(
        (connection: ConnectionsType) => connection.id === connectionDetails.id,
      );
      if (connection) {
        return { connectedConnection: connection };
      } else {
        return rejectWithValue("No current connection found.");
      }
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  },
);

const initialState: {
  connections: ConnectionsType[] | null;
  currentConnection: ConnectionsType | null;
  connectedConnection: ConnectionDetailsType | null;
  connectionMessage: { success: boolean; error: string | null } | null;
  queryHistory: string[];
  loading: "initial" | "loading" | "idle";
} = {
  connections: null,
  currentConnection: null,
  connectedConnection: null,
  connectionMessage: null,
  queryHistory: [],
  loading: "idle",
};
export const appDBSlice = createSlice({
  name: "App-DB",
  initialState,
  reducers: {
    resetAppDB: (state) => {
      state = initialState;
    },
    setConnections: (state, action) => {
      state.connections = action.payload;
    },
    setCurrentConnection: (state, action) => {
      state.currentConnection = action.payload;
    },
    setConnectedConnection: (state, action) => {
      state.connectedConnection = action.payload;
    },
    removeConnection: (state, action) => {
      if (state.connections) {
        const remainingConnection = state.connections.filter(
          ({ id }) => id !== action.payload.id,
        );
        state.connections = remainingConnection;
      }
    },
    addOrUpdateConnection: (state, action: PayloadAction<ConnectionsType>) => {
      if (state.connections) {
        const index = state.connections.findIndex(
          ({ id }) => id === action.payload.id,
        );
        if (index !== -1) {
          // Update existing connection
          state.connections[index] = action.payload;
          state.queryHistory = action.payload.queryHistory || [];
        } else {
          // Add new connection
          state.connections.push(action.payload);
          state.queryHistory = action.payload.queryHistory || [];
        }
      } else {
        state.connections = [action.payload];
      }
    },
    setConnectionLoading: (state, action) => {
      state.loading = action.payload;
    },
    setQueryHistory: (state, action) => {
      state.queryHistory = action.payload;
    },
    setLoading: (state, action) => {
      state.loading = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // .addCase(initAppData.pending, (state) => {
      //   state.loading = "initial"; // Set loading to true when fetching starts
      // })
      // .addCase(initAppData.fulfilled, (state, action) => {
      //   state.loading = "idle"; // Set loading to false when fetching is done
      //   state.connections = action.payload.connections;
      // })
      // .addCase(initAppData.rejected, (state, action) => {
      //   state.loading = "idle"; // Set loading to false on error
      //   // Optionally, you can store the error message in the state
      //   // state.connectionMessage = { success: false, error: action.payload as string };
      // })
      .addCase(initConnectedConnection.pending, (state) => {
        state.loading = "loading";
      })
      .addCase(initConnectedConnection.fulfilled, (state, action) => {
        state.loading = "idle";
        state.connectedConnection = action.payload.connectedConnection;
        state.queryHistory =
          action.payload.connectedConnection.queryHistory || [];
      })
      .addCase(initConnectedConnection.rejected, (state, action) => {
        state.loading = "idle";
        state.connectedConnection = null;
        state.queryHistory = [];
      });
  },
});

export const {
  setConnections,
  resetAppDB,
  setCurrentConnection,
  removeConnection,
  addOrUpdateConnection,
  setConnectionLoading,
  setLoading,
} = appDBSlice.actions;

export default appDBSlice.reducer;
