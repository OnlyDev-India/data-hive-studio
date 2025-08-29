import { ConnectionDetailsType, DatabaseClient } from "@/types/db.type";
import { handlers } from "./db";
import { connectDb } from "../actions/fetch-data";

export interface ConnectionConfig {
  maxRetries: number;
  retryDelay: number;
  healthCheckInterval: number;
  connectionTimeout: number;
  keepAliveInterval: number;
}

export interface ConnectionState {
  isConnected: boolean;
  lastHealthCheck: Date;
  connectionAttempts: number;
  lastError: string | null;
  isReconnecting: boolean;
}

export class EnhancedConnectionManager {
  private static instance: EnhancedConnectionManager;
  private connections: Map<string, DatabaseClient>;
  private connectionStates: Map<string, ConnectionState>;
  private connectionDetails: Map<
    string,
    { details: ConnectionDetailsType; dbType: keyof typeof handlers }
  >;
  private healthCheckIntervals: Map<string, NodeJS.Timeout>;
  private reconnectionTimeouts: Map<string, NodeJS.Timeout>;
  private periodicCleanupInterval: NodeJS.Timeout | null = null;
  private currentConnectionId: string | null = null;

  private config: ConnectionConfig = {
    maxRetries: 3,
    retryDelay: 5000, // 5 seconds
    healthCheckInterval: 30000, // 30 seconds
    connectionTimeout: 10000, // 10 seconds
    keepAliveInterval: 60000, // 1 minute
  };

  private constructor() {
    this.connections = new Map();
    this.connectionStates = new Map();
    this.connectionDetails = new Map();
    this.healthCheckIntervals = new Map();
    this.reconnectionTimeouts = new Map();
  }

  public static getInstance(): EnhancedConnectionManager {
    if (!EnhancedConnectionManager.instance) {
      EnhancedConnectionManager.instance = new EnhancedConnectionManager();
    }
    return EnhancedConnectionManager.instance;
  }

  public setConfig(config: Partial<ConnectionConfig>) {
    this.config = { ...this.config, ...config };
  }

  private initializeConnectionState(connectionId: string): ConnectionState {
    return {
      isConnected: false,
      lastHealthCheck: new Date(),
      connectionAttempts: 0,
      lastError: null,
      isReconnecting: false,
    };
  }

  private async performHealthCheck(connectionId: string): Promise<boolean> {
    const connection = this.connections.get(connectionId);
    const state = this.connectionStates.get(connectionId);

    if (!connection || !state) return false;

    try {
      // Check if connection is still alive
      const isConnected = connection.isConnectedToDb();

      if (isConnected) {
        // Additional check: try to execute a simple query
        await this.testConnectionHealth(connection);

        state.isConnected = true;
        state.lastHealthCheck = new Date();
        state.lastError = null;

        return true;
      } else {
        throw new Error("Connection is not active");
      }
    } catch (error) {
      console.warn(
        `Health check failed for connection ${connectionId}:`,
        error,
      );

      state.isConnected = false;
      state.lastError =
        error instanceof Error ? error.message : "Unknown error";

      // Trigger auto-reconnection
      this.scheduleReconnection(connectionId);

      return false;
    }
  }

  private async testConnectionHealth(
    connection: DatabaseClient,
  ): Promise<void> {
    // Try to execute a simple query to test connection health
    try {
      if ("executeQuery" in connection) {
        // For SQL databases, use a simple SELECT query
        if (connection.constructor.name === "PostgresClient") {
          await connection.executeQuery("SELECT 1");
        } else if (connection.constructor.name === "MongoDbClient") {
          // For MongoDB, try to list collections
          await connection.getDatabases();
        }
      }
    } catch (error) {
      throw new Error(`Connection health check failed: ${error}`);
    }
  }

  private scheduleHealthCheck(connectionId: string) {
    // Clear existing health check
    const existingInterval = this.healthCheckIntervals.get(connectionId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Schedule new health check
    const interval = setInterval(async () => {
      await this.performHealthCheck(connectionId);
    }, this.config.healthCheckInterval);

    this.healthCheckIntervals.set(connectionId, interval);
  }

  private scheduleReconnection(connectionId: string) {
    const state = this.connectionStates.get(connectionId);
    const connectionInfo = this.connectionDetails.get(connectionId);

    if (!state || !connectionInfo || state.isReconnecting) return;

    if (state.connectionAttempts >= this.config.maxRetries) {
      console.error(
        `Max reconnection attempts reached for connection ${connectionId}`,
      );
      this.notifyConnectionLost(connectionId);
      return;
    }

    state.isReconnecting = true;
    state.connectionAttempts++;

    const delay =
      this.config.retryDelay * Math.pow(2, state.connectionAttempts - 1); // Exponential backoff

    console.log(
      `Scheduling reconnection attempt ${state.connectionAttempts}/${this.config.maxRetries} for connection ${connectionId} in ${delay}ms`,
    );

    const timeout = setTimeout(async () => {
      await this.attemptReconnection(connectionId);
    }, delay);

    this.reconnectionTimeouts.set(connectionId, timeout);
  }

  private async attemptReconnection(connectionId: string): Promise<boolean> {
    const state = this.connectionStates.get(connectionId);
    const connectionInfo = this.connectionDetails.get(connectionId);

    if (!state || !connectionInfo) return false;

    console.log(`Attempting to reconnect ${connectionId}...`);

    try {
      // Clean up old connection
      await this.cleanupConnection(connectionId, false);

      // Create new connection
      const connection = new handlers[connectionInfo.dbType]();
      const result = await connection.connectDb({
        connectionDetails: connectionInfo.details,
      });

      if (result?.success) {
        this.connections.set(connectionId, connection);
        state.isConnected = true;
        state.isReconnecting = false;
        state.connectionAttempts = 0;
        state.lastError = null;
        state.lastHealthCheck = new Date();

        console.log(`Successfully reconnected to ${connectionId}`);

        // Resume health checks
        this.scheduleHealthCheck(connectionId);

        // Notify successful reconnection
        this.notifyReconnectionSuccess(connectionId);

        return true;
      } else {
        throw new Error(result?.error || "Reconnection failed");
      }
    } catch (error) {
      console.error(`Reconnection attempt failed for ${connectionId}:`, error);

      state.lastError =
        error instanceof Error ? error.message : "Reconnection failed";
      state.isReconnecting = false;

      // Schedule next attempt if we haven't exceeded max retries
      if (state.connectionAttempts < this.config.maxRetries) {
        this.scheduleReconnection(connectionId);
      } else {
        console.error(`All reconnection attempts failed for ${connectionId}`);
        this.notifyConnectionLost(connectionId);
      }

      return false;
    }
  }

  private async cleanupConnection(
    connectionId: string,
    removeState: boolean = true,
  ) {
    const connection = this.connections.get(connectionId);

    if (connection) {
      try {
        console.log(`🧹 Cleaning up connection ${connectionId}...`);
        
        // Call destroy method to ensure proper cleanup
        if (typeof connection.destroy === 'function') {
          connection.destroy();
          // Destroy method called for connection
        } else {
          await connection.disconnect();
        }
        
        // Additional cleanup: ensure connection is completely closed
        if (connection.isConnectedToDb && connection.isConnectedToDb()) {
          try {
            await connection.disconnect();
          } catch (forceError) {
            console.warn(`Force disconnect failed for ${connectionId}:`, forceError);
          }
        }
        
      } catch (error) {
        console.warn(
          `Error during connection cleanup for ${connectionId}:`,
          error,
        );
      } finally {
        // Always remove from connections map
        this.connections.delete(connectionId);
        console.log(`🗑️ Connection ${connectionId} removed from connections map`);
      }
    }

    // Clear health check interval
    const healthInterval = this.healthCheckIntervals.get(connectionId);
    if (healthInterval) {
      clearInterval(healthInterval);
      this.healthCheckIntervals.delete(connectionId);
    }

    // Clear reconnection timeout
    const reconnectionTimeout = this.reconnectionTimeouts.get(connectionId);
    if (reconnectionTimeout) {
      clearTimeout(reconnectionTimeout);
      this.reconnectionTimeouts.delete(connectionId);
    }

    if (removeState) {
      this.connectionStates.delete(connectionId);
      this.connectionDetails.delete(connectionId);
    }
  }

  private notifyReconnectionSuccess(connectionId: string) {
    // Dispatch custom event for UI to handle
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("database-reconnected", {
          detail: { connectionId },
        }),
      );
    }
  }

  private notifyConnectionLost(connectionId: string) {
    // Dispatch custom event for UI to handle
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("database-connection-lost", {
          detail: { connectionId },
        }),
      );
    }
  }

  public async connect({
    connectionDetails,
    dbType,
  }: {
    connectionDetails: ConnectionDetailsType;
    dbType: keyof typeof handlers;
  }) {
    try {
      if (!dbType || !(dbType in handlers)) {
        throw new Error("Invalid database type");
      }

      const connectionId = connectionDetails.id;

      // Cleanup existing connection if any - ensure complete destruction
      if (this.connections.has(connectionId)) {
        console.log(`🔄 Destroying old connection for ${connectionId} before creating new one...`);
        await this.cleanupConnection(connectionId);
        
        // Wait a bit to ensure cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Initialize connection state
      const state = this.initializeConnectionState(connectionId);
      this.connectionStates.set(connectionId, state);
      this.connectionDetails.set(connectionId, {
        details: connectionDetails,
        dbType,
      });

      // Create new connection
      const connection = new handlers[dbType]();
      const result = await connection.connectDb({ connectionDetails });

      if (result?.success) {
        this.connections.set(connectionId, connection);
        this.currentConnectionId = connectionId;

        state.isConnected = true;
        state.lastHealthCheck = new Date();
        state.connectionAttempts = 0;

        // Start health monitoring
        this.scheduleHealthCheck(connectionId);

        console.log(
          `✅ Successfully connected to ${connectionId} with auto-reconnection enabled`,
        );
      }

      return result || { success: false, error: "Connection failed" };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  public getConnection(connectionId: string): DatabaseClient | null {
    const connection = this.connections.get(connectionId);
    const state = this.connectionStates.get(connectionId);

    if (connection && state?.isConnected) {
      return connection;
    }

    // If connection exists but is not healthy, trigger health check
    if (connection && !state?.isConnected && !state?.isReconnecting) {
      this.performHealthCheck(connectionId);
    }

    return null;
  }

  public getCurrentConnection(): DatabaseClient | null {
    if (!this.currentConnectionId) return null;
    return this.getConnection(this.currentConnectionId);
  }

  public getCurrentConnectionDetails(): ConnectionDetailsType | null {
    if (!this.currentConnectionId) return null;
    const connectionInfo = this.connectionDetails.get(this.currentConnectionId);
    return connectionInfo?.details || null;
  }

  public getConnectionState(connectionId: string): ConnectionState | null {
    return this.connectionStates.get(connectionId) || null;
  }

  public getAllConnectionStates(): Map<string, ConnectionState> {
    return new Map(this.connectionStates);
  }

  public async disconnect(connectionId: string) {
    await this.cleanupConnection(connectionId);

    if (this.currentConnectionId === connectionId) {
      this.currentConnectionId = null;
    }
  }

  public async disconnectAll() {
    const connectionIds = Array.from(this.connections.keys());
    console.log(`🔄 Disconnecting all ${connectionIds.length} connections...`);

    for (const connectionId of connectionIds) {
      await this.cleanupConnection(connectionId);
    }

    this.currentConnectionId = null;
    console.log(`✅ All connections disconnected and destroyed`);
  }

  // Force cleanup all connections and reset state - useful when switching databases
  public async forceCleanupAll() {
    console.log(`🧹 Force cleaning up all connections...`);
    
    // Clear all intervals and timeouts first
    for (const [connectionId, interval] of Array.from(this.healthCheckIntervals)) {
      clearInterval(interval);
      console.log(`⏰ Health check interval cleared for ${connectionId}`);
    }
    this.healthCheckIntervals.clear();
    
    for (const [connectionId, timeout] of Array.from(this.reconnectionTimeouts)) {
      clearTimeout(timeout);
      console.log(`⏰ Reconnection timeout cleared for ${connectionId}`);
    }
    this.reconnectionTimeouts.clear();
    
    // Clear periodic cleanup interval
    if (this.periodicCleanupInterval) {
      clearInterval(this.periodicCleanupInterval);
      this.periodicCleanupInterval = null;
      console.log(`⏰ Periodic cleanup interval cleared`);
    }
    
    // Disconnect all connections
    await this.disconnectAll();
    
    // Clear all state
    this.connectionStates.clear();
    this.connectionDetails.clear();
    
    console.log(`✅ Force cleanup completed - all connections destroyed and state reset`);
  }

  // Switch database connection - ensures old connections are completely destroyed
  public async switchDatabase(
    connectionDetails: ConnectionDetailsType,
    dbType: keyof typeof handlers
  ) {
    console.log(`🔄 Switching database connection...`);
    
    // Force cleanup all existing connections first
    await this.forceCleanupAll();
    
    // Wait a bit to ensure cleanup is complete
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Now connect to the new database
    const result = await this.connect({ connectionDetails, dbType });
    
    if (result.success) {
      console.log(`✅ Successfully switched to new database: ${connectionDetails.name}`);
    } else {
      console.error(`❌ Failed to switch database: ${result.error}`);
    }
    
    return result;
  }

  public async forceReconnect(connectionId: string): Promise<boolean> {
    const state = this.connectionStates.get(connectionId);
    if (state) {
      state.connectionAttempts = 0; // Reset attempt counter
      state.isReconnecting = false;
      return await this.attemptReconnection(connectionId);
    }
    await connectDb();
    return true;
  }

  public isConnectionHealthy(connectionId: string): boolean {
    const state = this.connectionStates.get(connectionId);
    return state?.isConnected || false;
  }

  public getLastError(connectionId: string): string | null {
    const state = this.connectionStates.get(connectionId);
    return state?.lastError || null;
  }

  // Cleanup method for serverless environments
  public cleanup() {
    // Clear all intervals and timeouts
    for (const [connectionId, interval] of Array.from(this.healthCheckIntervals)) {
      clearInterval(interval);
    }
    for (const [connectionId, timeout] of Array.from(this.reconnectionTimeouts)) {
      clearTimeout(timeout);
    }
    
    // Disconnect all connections
    this.disconnectAll();
  }
}
