import { createAsyncThunk } from "@reduxjs/toolkit";
import { LocalAppStorePath } from "@/config/local-app-store-path";
import {
  ensureConnectionApiPresent,
  initializeAPIDetailsFile,
} from "@/lib/actions/api-data";
import { ensureConnectionsHaveAPIs } from "@/lib/actions/app-data";
import { getAPIDetails } from "@/lib/actions/api-data";
import { createEndpoint } from "@/lib/actions/api-data";
import { getAPIsByConnectionId } from "@/lib/actions/api-data";
import { toggleAPIRunning } from "@/lib/actions/api-data";
import { APIEndpointForm } from "../types/custom-api.type";

// Initialize API details file
export const initAPIDetails = createAsyncThunk(
  "api/initAPIDetails",
  async ({connectionId}: {connectionId?: string}, { rejectWithValue }) => {
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

      if (connectionId) {
        const ensureApiHasConnectionIdResult = await ensureConnectionApiPresent(
          apiDetailsPath,
          connectionId,
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
            connectionId,
            ensureApiHasConnectionIdResult.data.id,
          );
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
  async (connectionId: string, { rejectWithValue }) => {
    try {
      if (typeof window === "undefined" || !window.electron) {
        throw new Error("Electron environment not available.");
      }

      const apiDetailsPath =
        (await window.electron.getConnectionsJsonPath()) +
        LocalAppStorePath.apiDetailsJsonPath;

      const response = await getAPIsByConnectionId(
        apiDetailsPath,
        connectionId,
      );

      if (response.success && response.data) {
        return { connectionId, apis: response.data };
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
