import { ConnectionDetailsType } from "@/types/db.type";
import { TableForm } from "@/types/table.type";
import { redirect } from "next/navigation";
import { getCookie } from "../actions/fetch-data";

export abstract class DatabaseClient {
  protected connectionDetails: ConnectionDetailsType | null = null;
  protected isConnected: boolean = false;
  public isConnecting: boolean = false;

  // Abstract methods that must be implemented by subclasses
  abstract connectDb(params: {
    connectionDetails: ConnectionDetailsType;
  }): Promise<{ success: boolean; error?: string }>;
  abstract disconnect(): Promise<void>;
  abstract executeQuery(query: string): Promise<any>;
  abstract testConnection(params: {
    connectionDetails: ConnectionDetailsType;
  }): Promise<{ success: boolean; error?: string }>;
  abstract getTablesWithFieldsFromDb(
    currentSchema: string,
    isUpdateSchema?: boolean,
  ): Promise<any>;
  abstract getDatabases(): Promise<any>;
  abstract getSchemas(): Promise<any>;
  abstract getTableColumns(tableName: string): Promise<any>;
  abstract getTablesData(tableName: string, options?: any): Promise<any>;
  abstract getTableRelations(tableName: string): Promise<any>;
  abstract dropTable(tableName: string): Promise<any>;
  abstract updateTable(
    tableName: string,
    data: Array<{
      oldValue: Record<string, any>;
      newValue: Record<string, any>;
    }>,
  ): Promise<any>;
  abstract deleteTableData(tableName: string, data: any[]): Promise<any>;
  abstract insertRecord(data: {
    tableName: string;
    values: any[][];
  }): Promise<any>;
  abstract createTable(data: TableForm): Promise<any>;

  constructor() {
    this.connectionDetails = null;
    this.isConnected = false;
  }

  // Pre-implemented common methods
  isConnectedToDb(): boolean {
    return this.isConnected;
  }

  getConnectionDetails(): ConnectionDetailsType | null {
    return this.connectionDetails;
  }

  setConnectionDetails(connectionDetails: ConnectionDetailsType): void {
    this.connectionDetails = connectionDetails;
  }

  async disconnectDb(): Promise<void> {
    this.isConnected = false;
    this.isConnecting = false;
    this.connectionDetails = null;
    return await this.disconnect();
  }

  // Method to check if connection is in a valid state
  public isConnectionValid(): boolean {
    return this.isConnected && !this.isConnecting && this.connectionDetails !== null;
  }

  // Common validation methods
  public async validateConnection(): Promise<boolean> {
    try {
      if (!this.isConnected && !this.isConnecting) {
        this.isConnecting = true;
        await this.getConnectionDetailsFromCookies();
        if (!this.connectionDetails) {
          redirect("/");
        }
        const connectResult = await this.connectDb({
          connectionDetails: this.connectionDetails,
        });
        if (!connectResult.success) {
          throw new Error(connectResult.error || "Failed to connect to database");
        }
        this.isConnected = true;
      }
      return true;
    } catch (error) {
      return false;
    } finally {
      this.isConnecting = false;
    }
  }

  protected validateTableName(tableName: string): void {
    if (!tableName || typeof tableName !== "string") {
      throw new Error("Invalid table name provided.");
    }
  }

  protected validateQuery(query: string): void {
    if (!query || typeof query !== "string") {
      throw new Error("Invalid query provided.");
    }
  }

  // Common error handling
  protected handleError(
    error: any,
    operation: string,
  ): { success: false; error: string } {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Database operation failed (${operation}):`, errorMessage);
    return { success: false, error: errorMessage };
  }

  // Common success response
  protected createSuccessResponse<T>(data?: T): { success: true; data?: T } {
    return { success: true, data };
  }

  // Protected function to get connection details from cookies
  public async getConnectionDetailsFromCookies(): Promise<{
    response: { success: boolean; error?: string };
    connectionDetails: ConnectionDetailsType | null;
    dbType: string | null;
  }> {
    const cookie = await getCookie();
    const connectionUrl = cookie.get("currentConnection");
    if (!connectionUrl) {
      return {
        response: { success: false, error: "No connection to the database" },
        connectionDetails: null,
        dbType: null,
      };
    }
    if (!connectionUrl.value) {
      return {
        response: { success: false, error: "No connection to the database" },
        connectionDetails: null,
        dbType: null,
      };
    }

    const connectionDetails: ConnectionDetailsType = JSON.parse(
      connectionUrl?.value || "",
    );
    const dbType = (cookie.get("dbType")?.value as string) || null;

    if (!dbType) {
      return {
        response: { success: false, error: "Database type not specified" },
        connectionDetails: null,
        dbType: null,
      };
    }

    this.connectionDetails = connectionDetails;

    return {
      response: { success: true },
      connectionDetails,
      dbType,
    };
  }

  // Protected function to connect to database with validation and error handling
  protected async ensureConnected(): Promise<{
    success: boolean;
    error?: string;
  }> {
    // If already connected, return success
    if (this.isConnected && this.connectionDetails) {
      return this.createSuccessResponse();
    }

    // Get connection details from cookies
    const { response, connectionDetails, dbType } =
      await this.getConnectionDetailsFromCookies();

    if (!response.success || !connectionDetails || !dbType) {
      // Redirect to home page for missing connection details
      redirect("/");
    }

    try {
      // Attempt to connect using the abstract connectDb method
      const connectResult = await this.connectDb({ connectionDetails });

      if (connectResult.success) {
        return this.createSuccessResponse();
      } else {
        // Check if it's a connection/authentication error (wrong URL/details)
        const errorMessage = connectResult.error?.toLowerCase() || "";
        const isConnectionError =
          errorMessage.includes("connection") ||
          errorMessage.includes("authentication") ||
          errorMessage.includes("invalid") ||
          errorMessage.includes("unauthorized") ||
          errorMessage.includes("access denied") ||
          errorMessage.includes("host") ||
          errorMessage.includes("port") ||
          errorMessage.includes("database") ||
          errorMessage.includes("username") ||
          errorMessage.includes("password");

        if (isConnectionError) {
          // Redirect to home page for wrong connection details
          redirect("/");
        } else {
          // Return error for network or other issues
          return { success: false, error: connectResult.error };
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isConnectionError =
        errorMessage.toLowerCase().includes("connection") ||
        errorMessage.toLowerCase().includes("authentication") ||
        errorMessage.toLowerCase().includes("invalid") ||
        errorMessage.toLowerCase().includes("unauthorized") ||
        errorMessage.toLowerCase().includes("access denied");

      if (isConnectionError) {
        // Redirect to home page for wrong connection details
        redirect("/");
      } else {
        // Return error for network or other issues
        return this.handleError(error, "ensureConnected");
      }
    }
  }

  // Cleanup method (optional override)
  destroy?(): void;
  finalize?(): void;
}
