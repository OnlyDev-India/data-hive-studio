import { DatabaseClient } from "@/types/db.type";
import { handlers } from "./db";
import { getCookie } from "../actions/fetch-data";

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
  private static instance: EnhancedConnectionManager | null = null;
  private connection: DatabaseClient | null = null;

  private constructor(dbType: keyof typeof handlers) {
    this.connection = null;
    if (!dbType || !(dbType in handlers)) {
      throw new Error("Invalid database type");
    }
    if (!this.connection) {
      this.connection = new handlers[dbType]();
      this.connect();
    }
  }

  public static async getInstance(): Promise<EnhancedConnectionManager> {
    const cookie = await getCookie();
    const dbType = cookie.get("dbType")?.value as keyof typeof handlers;
    if (!EnhancedConnectionManager.instance) {
      EnhancedConnectionManager.instance = new EnhancedConnectionManager(dbType);
    }
   await EnhancedConnectionManager.instance.connection?.validateConnection();
    return EnhancedConnectionManager.instance;
  }

  public getConnection(): DatabaseClient | null {
    return this.connection;
  }

  public async connect(): Promise<{ success: boolean, error?: string }> {
    if(!this.connection) {
      return { success: false, error: "No connection to the database" };
    }
    const result = await this.connection.getConnectionDetailsFromCookies();
    if(!result.connectionDetails) {
      return { success: false, error: "No connection to the database" };
    }
    await this.connection.disconnect();
    await this.connection.connectDb({ connectionDetails: result.connectionDetails });
    return { success: true };
  }

  public async disconnect(): Promise<void> {
    EnhancedConnectionManager.instance = null;
    const result = await this.connection?.disconnectDb();
    this.connection = null;
    return result;
  }
}
