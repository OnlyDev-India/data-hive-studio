import { createAsyncThunk } from "@reduxjs/toolkit";
import { LocalAppStorePath } from "@/config/local-app-store-path";
import {
  ensureConnectionApiPresent,
  initializeAPIDetailsFile,
  updateAPI,
} from "@/features/custom-api/lib/actions/api-data";
import { ensureConnectionsHaveAPIs } from "@/lib/actions/app-data";
import { getAPIDetails } from "@/features/custom-api/lib/actions/api-data";
import { createEndpoint } from "@/features/custom-api/lib/actions/api-data";
import { getAPIsByConnectionId } from "@/features/custom-api/lib/actions/api-data";
import { toggleAPIRunning } from "@/features/custom-api/lib/actions/api-data";
import { updateEndpoint } from "@/features/custom-api/lib/actions/api-data";
import {
  APIEndpointForm,
  APIEndpoint,
  APIDetails,
} from "../types/custom-api.type";
import {
  restartCustomServerAction,
  startCustomServerAction,
  stopCustomServerAction,
} from "../lib/actions/server";
import { RootState } from "@/redux/store";
import { getCurrentConnectionDetails } from "@/lib/actions/database-backup";

export const closeAPIServer = createAsyncThunk(
  "api/closeAPIServer",
  async (_, { rejectWithValue, getState }) => {
    try {
      if (typeof window === "undefined" || !window.electron) {
        throw new Error("Electron environment not available.");
      }

      const api = (getState() as RootState).api.currentAPI;
      if (!api) {
        throw new Error("API not found");
      }
      await stopCustomServerAction(api);
      return api;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  },
);

// Initialize API details file
export const initAPIDetails = createAsyncThunk(
  "api/initAPIDetails",
  async (_, { rejectWithValue }) => {
    try {
      if (typeof window === "undefined" || !window.electron) {
        return rejectWithValue(
          new Error("Electron environment not available."),
        );
      }

      const apiDetailsPath =
        (await window.electron.getConnectionsJsonPath()) +
        LocalAppStorePath.apiDetailsJsonPath;
      const connectionPath =
        (await window.electron.getConnectionsJsonPath()) +
        LocalAppStorePath.connectionsJsonPath;

      // Ensure connections have APIs field

      // Initialize API details file
      const initResult = await initializeAPIDetailsFile(apiDetailsPath);
      if (!initResult.success) {
        throw new Error(initResult.error);
      }

      const connection = await getCurrentConnectionDetails();
      if(!connection) {
        throw new Error("Connection not found");
      }

      if (connection.id) {
        const ensureApiHasConnectionIdResult = await ensureConnectionApiPresent(
          apiDetailsPath,
          connection.id,
        );
        if (!ensureApiHasConnectionIdResult.success) {
          throw new Error(ensureApiHasConnectionIdResult.error);
        }
        if (
          ensureApiHasConnectionIdResult.data &&
          ensureApiHasConnectionIdResult.isUpdated
        ) {
          await ensureConnectionsHaveAPIs(
            connectionPath,
            connection.id,
            ensureApiHasConnectionIdResult.data.id,
          );
        }
        //if api id is present then ans api enabled to true then start the server
        if (
          ensureApiHasConnectionIdResult.data &&
          ensureApiHasConnectionIdResult.data.enabled
        ) {
          await startCustomServerAction(ensureApiHasConnectionIdResult.data);
        }
      }

      // Get all API details
      const response = await getAPIDetails(apiDetailsPath);

      if (response.success && response.data) {
        return response.data;
      } else {
        return rejectWithValue(
          response.error || "Failed to fetch API details.",
        );
      }
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  },
);

// Create new API
export const createEndPoint = createAsyncThunk(
  "api/createAPI",
  async (
    {
      connectionId,
      api,
    }: {
      connectionId: string;
      api: APIEndpointForm;
    },
    { rejectWithValue },
  ) => {
    try {
      if (typeof window === "undefined" || !window.electron) {
        throw new Error("Electron environment not available.");
      }

      const apiDetailsPath =
        (await window.electron.getConnectionsJsonPath()) +
        LocalAppStorePath.apiDetailsJsonPath;
      // const connectionPath =
      //   (await window.electron.getConnectionsJsonPath()) +
      //   LocalAppStorePath.connectionsJsonPath;

      const response = await createEndpoint(apiDetailsPath, connectionId, api);

      if (response.success && response.data) {
        return response.data;
      } else {
        return rejectWithValue(response.error || "Failed to create API.");
      }
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  },
);

// Get APIs by connection ID
export const getAPIsForConnection = createAsyncThunk(
  "api/getAPIsForConnection",
  async (_, { rejectWithValue }) => {
    try {
      if (typeof window === "undefined" || !window.electron) {
        throw new Error("Electron environment not available.");
      }

      const apiDetailsPath =
        (await window.electron.getConnectionsJsonPath()) +
        LocalAppStorePath.apiDetailsJsonPath;

      const response = await getAPIsByConnectionId(
        apiDetailsPath,
      );

      if (response.success && response.data) {
        return { apis: response.data };
      } else {
        return rejectWithValue(
          response.error || "Failed to fetch APIs for connection.",
        );
      }
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  },
);

// Toggle API running state
export const toggleAPI = createAsyncThunk(
  "api/toggleAPI",
  async (apiId: string, { rejectWithValue }) => {
    try {
      if (typeof window === "undefined" || !window.electron) {
        throw new Error("Electron environment not available.");
      }

      const apiDetailsPath =
        (await window.electron.getConnectionsJsonPath()) +
        LocalAppStorePath.apiDetailsJsonPath;

      const response = await toggleAPIRunning(apiDetailsPath, apiId);

      if (response.success && response.data) {
        return response.data;
      } else {
        return rejectWithValue(response.error || "Failed to toggle API.");
      }
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  },
);

export const updateCurrentAPI = createAsyncThunk(
  "api/updateCurrentAPI",
  async (api: APIDetails, { rejectWithValue }) => {
    try {
      if (typeof window === "undefined" || !window.electron) {
        throw new Error("Electron environment not available.");
      }

      const apiDetailsPath =
        (await window.electron.getConnectionsJsonPath()) +
        LocalAppStorePath.apiDetailsJsonPath;

      const response = await updateAPI(apiDetailsPath, api);

      if (response.success && response.data) {
        if (response.data.enabled) {
          await restartCustomServerAction(response.data);
        }
        return response.data;
      } else {
        return rejectWithValue(response.error || "Failed to update API.");
      }
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  },
);

// Update endpoint
export const updateEndPoint = createAsyncThunk(
  "api/updateEndPoint",
  async (
    {
      connectionId,
      endpointId,
      endpoint,
    }: {
      connectionId: string;
      endpointId: string;
      endpoint: APIEndpoint;
    },
    { rejectWithValue },
  ) => {
    try {
      if (typeof window === "undefined" || !window.electron) {
        throw new Error("Electron environment not available.");
      }

      const apiDetailsPath =
        (await window.electron.getConnectionsJsonPath()) +
        LocalAppStorePath.apiDetailsJsonPath;

      const response = await updateEndpoint(
        apiDetailsPath,
        connectionId,
        endpointId,
        endpoint,
      );

      if (response.success && response.data) {
        return response.data;
      } else {
        return rejectWithValue(response.error || "Failed to update endpoint.");
      }
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  },
);
