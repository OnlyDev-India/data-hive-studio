"use server";
import { ConnectionDetailsType } from "@/types/db.type";
import { parseConnectionString } from "@/lib/helper/connection-details";
import { PostgresBackup } from "@/lib/databases/postgres/backup";
import { SqliteBackup } from "@/lib/databases/sqlite/backup";
import { MongoBackup } from "@/lib/databases/mongodb/backup";
import { getConnectionDetails } from "./fetch-data";

export interface DatabaseBackupOptions {
  includeData: boolean;
  includeSchema: boolean;
  includeIndexes: boolean;
  includeConstraints: boolean;
  format: "sql" | "json" | "csv";
  compression: boolean;
}

export interface BackupResult {
  success: boolean;
  data?: string;
  fileName?: string;
  error?: string;
  backupSize?: number;
  tablesCount?: number;
  recordsCount?: number;
}

export interface BackupCommand {
  command: string;
  description: string;
  additionalCommands?: BackupCommand[];
}

export async function generateDatabaseBackupCommands(): Promise<
  BackupCommand[]
> {
  try {
    const { connectionDetails: connectionDetails, dbType } =
      await getConnectionDetails();
    // const connection = await getDbInstance();

    // if (!connection) {
    //   throw new Error("No active database connection");
    // }

    if (!connectionDetails) {
      throw new Error("No connection details found");
    }

    const config = parseConnectionString(connectionDetails.connection_string);
    if (config.error) {
      throw new Error(config.error);
    }

    switch (dbType) {
      case "pgSql":
        const postgresBackup = new PostgresBackup(connectionDetails);
        return postgresBackup.generateBackupCommands(
          connectionDetails.connection_string,
        );

      case "sqlite":
        const sqliteBackup = new SqliteBackup(connectionDetails);
        return sqliteBackup.generateBackupCommands(
          connectionDetails.connection_string,
        );

      case "mongodb":
        const mongoBackup = new MongoBackup(connectionDetails);
        return mongoBackup.generateBackupCommands(
          connectionDetails.connection_string,
        );

      default:
        throw new Error(`Unsupported database type: ${dbType}`);
    }
  } catch (error) {
    console.error("Failed to generate backup commands:", error);
    throw error;
  }
}

// Legacy function - kept for compatibility but deprecated
export async function createDatabaseBackup(
  connectionDetails: ConnectionDetailsType,
  options: DatabaseBackupOptions = {
    includeData: true,
    includeSchema: true,
    includeIndexes: true,
    includeConstraints: true,
    format: "sql",
    compression: false,
  },
): Promise<BackupResult> {
  console.warn(
    "createDatabaseBackup is deprecated. Use generateDatabaseBackupCommands instead.",
  );
  return {
    success: false,
    error:
      "This function is deprecated. Use generateDatabaseBackupCommands to get terminal commands instead.",
  };
}

// Helper functions for statistics
export async function getTablesCount(connection: any): Promise<number> {
  try {
    const tables = await connection.executeQuery(
      "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'",
    );
    return tables.data?.[0]?.count || 0;
  } catch (error) {
    return 0;
  }
}

export async function getRecordsCount(connection: any): Promise<number> {
  try {
    let totalRecords = 0;
    const tables = await connection.executeQuery(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );

    for (const table of tables.data || []) {
      const countQuery = `SELECT COUNT(*) as count FROM "${table.table_name}"`;
      const result = await connection.executeQuery(countQuery);
      totalRecords += result.data?.[0]?.count || 0;
    }

    return totalRecords;
  } catch (error) {
    return 0;
  }
}

// Database-specific backup functions - deprecated
export async function createPostgresBackup(
  connection: any,
  options: DatabaseBackupOptions,
): Promise<BackupResult> {
  console.warn(
    "createPostgresBackup is deprecated. Use generateDatabaseBackupCommands instead.",
  );
  return {
    success: false,
    error:
      "This function is deprecated. Use generateDatabaseBackupCommands to get terminal commands instead.",
  };
}

export async function createSqliteBackup(
  connection: any,
  options: DatabaseBackupOptions,
): Promise<BackupResult> {
  console.warn(
    "createSqliteBackup is deprecated. Use generateDatabaseBackupCommands instead.",
  );
  return {
    success: false,
    error:
      "This function is deprecated. Use generateDatabaseBackupCommands to get terminal commands instead.",
  };
}

export async function createMongoBackup(
  connection: any,
  options: DatabaseBackupOptions,
): Promise<BackupResult> {
  console.warn(
    "createMongoBackup is deprecated. Use generateDatabaseBackupCommands instead.",
  );
  return {
    success: false,
    error:
      "This function is deprecated. Use generateDatabaseBackupCommands to get terminal commands instead.",
  };
}

// Restore functions (placeholders for future implementation)
export async function restorePostgresBackup(
  connection: any,
  backupData: string,
): Promise<BackupResult> {
  try {
    // Implementation for PostgreSQL restore
    return { success: true, error: "PostgreSQL restore not yet implemented" };
  } catch (error) {
    return { success: false, error: `PostgreSQL restore failed: ${error}` };
  }
}

export async function restoreSqliteBackup(
  connection: any,
  backupData: string,
): Promise<BackupResult> {
  try {
    // Implementation for SQLite restore
    return { success: true, error: "SQLite restore not yet implemented" };
  } catch (error) {
    return { success: false, error: `SQLite restore failed: ${error}` };
  }
}

export async function restoreMongoBackup(
  connection: any,
  backupData: string,
): Promise<BackupResult> {
  try {
    // Implementation for MongoDB restore
    return { success: true, error: "MongoDB restore not yet implemented" };
  } catch (error) {
    return { success: false, error: `MongoDB restore failed: ${error}` };
  }
}
