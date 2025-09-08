"use server";

import {
  APIDetails,
  APIDetailsStore,
  APIEndpoint
} from "@/features/custom-api/types/custom-api.type";
import { promises as fs } from "fs";
import { API_FORM_DEFAULT_VALUES } from "@/features/custom-api/config/default-values";

// Read API details from file
async function readAPIDetails(
  apiDetailsPath: string,
): Promise<APIDetailsStore> {
  try {
    const data = await fs.readFile(apiDetailsPath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, return empty structure
    return { apiDetails: {} };
  }
}

// Write API details to file
async function writeAPIDetails(
  apiDetailsPath: string,
  apiDetails: APIDetailsStore,
): Promise<void> {
  await fs.writeFile(apiDetailsPath, JSON.stringify(apiDetails, null, 2));
}

// Read connections with APIs
async function readConnectionsWithAPIs(connectionPath: string): Promise<any> {
  const filePath = connectionPath;
  const data = await fs.readFile(filePath, "utf8");
  return JSON.parse(data);
}

// Write connections with APIs
async function writeConnectionsWithAPIs(
  connectionPath: string,
  connections: any,
): Promise<void> {
  const filePath = connectionPath;
  await fs.writeFile(filePath, JSON.stringify(connections, null, 2));
}

// Create API details file if it doesn't exist
export const initializeAPIDetailsFile = async (
  apiDetailsPath: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const apiDetails = await readAPIDetails(apiDetailsPath);
    await writeAPIDetails(apiDetailsPath, apiDetails);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// Ensure API has connection ID
export const ensureConnectionApiPresent = async (
  apiDetailsPath: string,
  connectionId: string,
): Promise<{
  success: boolean;
  error?: string;
  data?: APIDetails;
  isUpdated?: boolean;
}> => {
  try {
    const apiDetails = await readAPIDetails(apiDetailsPath);
    if (!apiDetails.apiDetails[connectionId]) {
      const id = crypto.randomUUID();
      apiDetails.apiDetails[connectionId] = {
        ...API_FORM_DEFAULT_VALUES,
        id: id,
        createdAt: new Date(),
        updatedAt: new Date(),
        connectionId: connectionId,
      };
      await writeAPIDetails(apiDetailsPath, apiDetails);
      return {
        success: true,
        data: apiDetails.apiDetails[connectionId],
        isUpdated: true,
      };
    }
    return { success: true, data: apiDetails.apiDetails[connectionId] };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// Get all API details
export const getAPIDetails = async (
  apiDetailsPath: string,
): Promise<{ success: boolean; data?: APIDetailsStore; error?: string }> => {
  try {
    const apiDetails = await readAPIDetails(apiDetailsPath);
    // await Promise.all(
    //   Object.keys(apiDetails.apiDetails).map(async (apiId) => {
    //     const api = apiDetails.apiDetails[apiId];
    //     const allGroups = api.groups || [];
    //     const allEndpoints = api.endpoints || [];
    //     const organizedGroups = await fetchNestedGroups(
    //       allGroups,
    //       allGroups,
    //       allEndpoints,
    //     );
    //     api.groups = organizedGroups;
    //   }),
    // );
    return { success: true, data: apiDetails };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const createEndpoint = async (
  apiDetailsPath: string,
  connectionId: string,
  api: Omit<APIEndpoint, "id" | "createdAt" | "updatedAt" | "connectionId">,
): Promise<{ success: boolean; data?: APIEndpoint; error?: string }> => {
  try {
    const apiDetails = await readAPIDetails(apiDetailsPath);
    const existingAPI = apiDetails.apiDetails[connectionId];

    if (!existingAPI) {
      return { success: false, error: "API not found" };
    }

    const newEndPoint: APIEndpoint = {
      ...api,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    existingAPI?.endpoints.push(newEndPoint);
    apiDetails.apiDetails[connectionId] = existingAPI;
    await writeAPIDetails(apiDetailsPath, apiDetails);

    return { success: true, data: newEndPoint };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// Get APIs by connection ID
export const getAPIsByConnectionId = async (
  apiDetailsPath: string,
  connectionId: string,
): Promise<{ success: boolean; data?: APIDetails; error?: string }> => {
  try {
    const apiDetails = await readAPIDetails(apiDetailsPath);
    const api = Object.values(apiDetails.apiDetails).filter(
      (api) => api.connectionId === connectionId,
    )[0];
    // const groups = api.groups || [];
    // const endpoints = api.endpoints || [];
    // const ungroupedEndpoints = endpoints.filter(
    //   (endpoint) => !endpoint.groupId,
    // );
    // const organizedGroups = fetchNestedGroups(groups, groups, endpoints);
    // api.processedGroups = organizedGroups;
    // api.ungroupedEndpoints = ungroupedEndpoints;
    return { success: true, data: api };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// Toggle API running state
export const toggleAPIRunning = async (
  apiDetailsPath: string,
  apiId: string,
): Promise<{ success: boolean; data?: APIDetails; error?: string }> => {
  try {
    const apiDetails = await readAPIDetails(apiDetailsPath);
    const api = apiDetails.apiDetails[apiId];

    if (!api) {
      return { success: false, error: "API not found" };
    }

    const updatedAPI = {
      ...api,
      enabled: !api.enabled,
      updatedAt: new Date(),
    };

    apiDetails.apiDetails[apiId] = updatedAPI;
    await writeAPIDetails(apiDetailsPath, apiDetails);

    return { success: true, data: updatedAPI };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};
