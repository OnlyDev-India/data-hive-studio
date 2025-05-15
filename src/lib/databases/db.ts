import { ConnectionDetailsType, DatabaseClient } from "@/types/db.type";
import { PostgresClient } from "./postgres";
import { SqliteClient } from "./sqlite";
import { MongoDbClient } from "./mongodb";

declare global {
  let dbConnection: PostgresClient | MongoDbClient | null;
  let appDB: SqliteClient | null;
}

export class AppDBManager {
  private static instance: AppDBManager;
  private appDB: SqliteClient | null = null;

  private constructor() {}

  public static getInstance(): AppDBManager {
    if (!AppDBManager.instance) {
      AppDBManager.instance = new AppDBManager();
    }
    return AppDBManager.instance;
  }

  public async connect(connectionDetails: ConnectionDetailsType) {
    try {
      const sqliteClient = new SqliteClient();
      const result = await sqliteClient.connectDb({ connectionDetails });

      if (result?.success) {
        this.appDB = sqliteClient;
      }

      return result || { success: false, error: "Connection failed" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  public getConnection(): SqliteClient | null {
    return this.appDB;
  }

  public async disconnect() {
    if (this.appDB) {
      await this.appDB.disconnect();
      this.appDB = null;
    }
  }
}

export class ConnectionManager {
  private static instance: ConnectionManager;
  private connections: Map<string, DatabaseClient>;
  private currentConnection: string | null;
  private connectionTimeouts: Map<string, NodeJS.Timeout>;

  private constructor() {
    this.connections = new Map();
    this.currentConnection = null;
    this.connectionTimeouts = new Map();
  }

  public static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  private async cleanupConnection(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      await connection.disconnect();
      this.connections.delete(connectionId);
      const timeout = this.connectionTimeouts.get(connectionId);
      if (timeout) {
        clearTimeout(timeout);
        this.connectionTimeouts.delete(connectionId);
      }
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
      
      // Cleanup existing connection if any
      if (this.connections.has(connectionId)) {
        await this.cleanupConnection(connectionId);
      }

      const connection = new handlers[dbType]();
      const result = await connection.connectDb({ connectionDetails });

      if (result?.success) {
        this.connections.set(connectionId, connection);
        this.currentConnection = connectionId;

        // Set connection timeout (e.g., 30 minutes)
        const timeout = setTimeout(() => {
          this.cleanupConnection(connectionId);
        }, 30 * 60 * 1000);
        
        this.connectionTimeouts.set(connectionId, timeout);
      }

      return result || { success: false, error: "Connection failed" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  public getConnection(connectionId: string): DatabaseClient | null {
    return this.connections.get(connectionId) || null;
  }

  public getCurrentConnection(): DatabaseClient | null {
    return this.currentConnection ? this.connections.get(this.currentConnection) || null : null;
  }

  public async disconnect(connectionId: string) {
    await this.cleanupConnection(connectionId);
    if (this.currentConnection === connectionId) {
      this.currentConnection = null;
    }
  }
}

export const handlers = {
  pgSql: PostgresClient,
  mongodb: MongoDbClient,
  sqlite: SqliteClient,
};

export type HandlersTypes = keyof typeof handlers;

// Remove global variables and old connection handler
export const connectToAppDB = async ({
  connectionDetails,
}: {
  connectionDetails: ConnectionDetailsType;
}) => {
  const appDBManager = AppDBManager.getInstance();
  return appDBManager.connect(connectionDetails);
};
