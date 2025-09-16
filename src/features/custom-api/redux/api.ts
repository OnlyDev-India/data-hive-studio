import {
  APIDetails,
  LoadingState,
} from "@/features/custom-api/types/custom-api.type";
import { createSlice } from "@reduxjs/toolkit";
import {
  initAPIDetails,
  createEndPoint,
  getAPIsForConnection,
  toggleAPI,
  updateEndPoint,
  updateCurrentAPI,
  closeAPIServer,
} from "../utils/data-thunk-func";

const initialState: {
  apis: APIDetails[];
  currentAPI: APIDetails | null;
  loading: LoadingState | "updatingEndpoint" | "updatingAPI" | "updatingCurrentAPI";
  error: string | null;
} = {
  apis: [],
  currentAPI: null,
  loading: "initializing",
  error: null,
};

export const apiSlice = createSlice({
  name: "api",
  initialState,
  reducers: {
    resetAPI: (state) => {
      state = initialState;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Initialize API details
      .addCase(initAPIDetails.pending, (state) => {
        state.loading = "initializing";
        state.error = null;
      })
      .addCase(initAPIDetails.fulfilled, (state, action) => {
        state.loading = "idle";
        state.apis = action.payload.apiDetails as any;
      })
      .addCase(initAPIDetails.rejected, (state, action) => {
        state.loading = "failed";
        state.error = action.payload as string;
      })

      // Create API
      .addCase(createEndPoint.pending, (state) => {
        state.loading = "creating";
        state.error = null;
      })
      .addCase(createEndPoint.fulfilled, (state, action) => {
        state.loading = "idle";
        const api = action.payload;
        state.currentAPI?.endpoints.push(api);
      })
      .addCase(createEndPoint.rejected, (state, action) => {
        state.loading = "failed";
        state.error = action.payload as string;
      })
      // Get APIs for connection
      .addCase(getAPIsForConnection.pending, (state) => {
        state.loading = "fetching";
        state.error = null;
      })
      .addCase(getAPIsForConnection.fulfilled, (state, action) => {
        state.loading = "idle";
        const { apis } = action.payload;
        state.currentAPI = apis;
      })
      .addCase(getAPIsForConnection.rejected, (state, action) => {
        state.loading = "failed";
        state.error = action.payload as string;
      })

      // Toggle API
      .addCase(toggleAPI.pending, (state) => {
        state.loading = "toggling";
        state.error = null;
      })
      .addCase(toggleAPI.fulfilled, (state, action) => {
        state.loading = "idle";
        state.currentAPI = action.payload;
      })
      .addCase(toggleAPI.rejected, (state, action) => {
        state.loading = "failed";
        state.error = action.payload as string;
      })

      // Update endpoint
      .addCase(updateEndPoint.pending, (state) => {
        state.loading = "updatingEndpoint";
        state.error = null;
      })
      .addCase(updateEndPoint.fulfilled, (state, action) => {
        state.loading = "idle";
        // Update the endpoint in the current API
        if (state.currentAPI) {
          const endpointIndex = state.currentAPI.endpoints.findIndex(
            ep => ep.id === action.payload.id
          );
          if (endpointIndex !== -1) {
            state.currentAPI.endpoints[endpointIndex] = action.payload;
          }
        }
      })
      .addCase(updateEndPoint.rejected, (state, action) => {
        state.loading = "failed";
        state.error = action.payload as string;
      })

      // Update API
      .addCase(updateCurrentAPI.pending, (state) => {
        state.loading = "updatingCurrentAPI";
        state.error = null;
      })
      .addCase(updateCurrentAPI.fulfilled, (state, action) => {
        state.loading = "idle";
        state.currentAPI = action.payload;
      })
      .addCase(updateCurrentAPI.rejected, (state, action) => {
        state.loading = "failed";
        state.error = action.payload as string;
      })

      // Close API server
      .addCase(closeAPIServer.pending, (state) => {
        state.loading = "toggling";
        state.error = null;
      })
      .addCase(closeAPIServer.fulfilled, (state, action) => {
        state.loading = "idle";
        state.currentAPI = null;
      })
      .addCase(closeAPIServer.rejected, (state, action) => {
        state.loading = "failed";
        state.error = action.payload as string;
      });
  },
});

export const { resetAPI, clearError } = apiSlice.actions;

export default apiSlice.reducer;
