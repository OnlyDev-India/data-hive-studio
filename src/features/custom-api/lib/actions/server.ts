"use server";

import { updateAPI } from "./api-data";
import { APIDetails } from "../../types/custom-api.type";
import { CustomServer } from "../custom-server";

// Global server instance

export const startCustomServerAction = async (options: APIDetails) => {
  try {
    if (!global.customServer) {
      global.customServer = {};
    }
    const oldServer = global.customServer[options.connectionId];

    if (oldServer?.isRunning() && !options.enabled) {
      console.log("Stopping server");
      oldServer.stop();
      return { success: true, message: "Server stopped" };
    }

    if (!options.enabled) {
      return { success: true, message: "Server is not enabled" };
    }

    // Stop existing server if running
    if (oldServer?.isRunning()) {
      throw new Error("Server is already running");
    }

    // Create and start new server
    global.customServer[options.connectionId] = new CustomServer(options);
    const currentServer = global.customServer[options.connectionId];
    if (!currentServer) {
      throw new Error("Failed to create server");
    }
    await currentServer.start();

    return { success: true, message: `Server started on port ${options.port}` };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to start server",
    };
  }
};

export const restartCustomServerAction = async (options: APIDetails) => {
  try {
    if (!options.enabled) {
      return { success: true, message: "Server is not enabled" };
    }
    await stopCustomServerAction(options);
    const result = await startCustomServerAction(options);
    if (result.success) {
      return { success: true, message: "Server restarted" };
    }
    return { success: false, error: result.error };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to restart server",
    };
  }
};

export const stopCustomServerAction = async (options: APIDetails) => {
  try {
    const currentServer = global.customServer[options.connectionId];
    if (currentServer?.isRunning()) {
      currentServer.stop();
      return { success: true, message: "Server stopped" };
    }
    return { success: false, error: "No server running" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to stop server",
    };
  }
};

export const getServerStatusAction = async (options: APIDetails) => {
  const currentServer = global.customServer[options.connectionId];
  return {
    isRunning: currentServer?.isRunning() || false,
    port: currentServer?.getPort() || null,
    endpoints: currentServer?.getEndpoints() || [],
    logCount: currentServer?.getLogCount() || 0,
  };
};

export const getServerLogsAction = async (
  options: APIDetails,
  limit?: number,
  level?: "info" | "warn" | "error" | "debug",
) => {
  try {
    const currentServer = global.customServer[options.connectionId];
    if (!currentServer) {
      return { success: false, error: "Server is not found" };
    }

    const logs = currentServer.getLogs(limit, level);
    return {
      success: true,
      logs,
      totalCount: currentServer.getLogCount(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch logs",
    };
  }
};

export const clearServerLogsAction = async (options: APIDetails) => {
  const currentServer = global.customServer[options.connectionId];
  try {
    if (!currentServer?.isRunning()) {
      return { success: false, error: "Server is not running" };
    }

    currentServer.clearLogs();
    return { success: true, message: "Logs cleared successfully" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to clear logs",
    };
  }
};
