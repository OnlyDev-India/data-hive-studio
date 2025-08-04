"use server";
import { ConnectionDetailsType } from "@/types/db.type";
import { EnhancedConnectionManager } from "@/lib/databases/connection-manager";
import { parseConnectionString } from "@/lib/helper/connection-details";
import { PostgresBackup } from "@/lib/databases/postgres/backup";
import { SqliteBackup } from "@/lib/databases/sqlite/backup";
import { MongoBackup } from "@/lib/databases/mongodb/backup";

export interface DatabaseBackupOptions {
  includeData: boolean;
  includeSchema: boolean;
  includeIndexes: boolean;
  includeConstraints: boolean;
  format: 'sql' | 'json' | 'csv';
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

export async function createDatabaseBackup(
  connectionDetails: ConnectionDetailsType,
  options: DatabaseBackupOptions = {
    includeData: true,
    includeSchema: true,
    includeIndexes: true,
    includeConstraints: true,
    format: 'sql',
    compression: false
  }
): Promise<BackupResult> {
  try {
    const connectionManager = EnhancedConnectionManager.getInstance();
    const connection = connectionManager.getCurrentConnection();
    
    if (!connection) {
      return { success: false, error: "No active database connection" };
    }

    const config = parseConnectionString(connectionDetails.connection_string);
    if (config.error) {
      return { success: false, error: config.error };
    }

    const dbType = connectionDetails.connection_type;
    
    switch (dbType) {
      case 'pgSql':
        const postgresBackup = new PostgresBackup(connection);
        return await postgresBackup.createBackup(options);
        
      case 'sqlite':
        const sqliteBackup = new SqliteBackup(connection);
        return await sqliteBackup.createBackup(options);
        
      case 'mongodb':
        const mongoBackup = new MongoBackup(connection);
        return await mongoBackup.createBackupWithOptions(options);
        
      default:
        return { success: false, error: `Unsupported database type: ${dbType}` };
    }
  } catch (error) {
    console.error("Database backup failed:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to create database backup" 
    };
  }
}

// Helper functions for statistics
export async function getTablesCount(connection: any): Promise<number> {
  try {
    const tables = await connection.executeQuery("SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'");
    return tables.data?.[0]?.count || 0;
  } catch (error) {
    return 0;
  }
}

export async function getRecordsCount(connection: any): Promise<number> {
  try {
    let totalRecords = 0;
    const tables = await connection.executeQuery("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    
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

// Database-specific backup functions
export async function createPostgresBackup(connection: any, options: DatabaseBackupOptions): Promise<BackupResult> {
  const postgresBackup = new PostgresBackup(connection);
  return await postgresBackup.createBackup(options);
}

export async function createSqliteBackup(connection: any, options: DatabaseBackupOptions): Promise<BackupResult> {
  const sqliteBackup = new SqliteBackup(connection);
  return await sqliteBackup.createBackup(options);
}

export async function createMongoBackup(connection: any, options: DatabaseBackupOptions): Promise<BackupResult> {
  const mongoBackup = new MongoBackup(connection);
  return await mongoBackup.createBackupWithOptions(options);
}

// Restore functions (placeholders for future implementation)
export async function restorePostgresBackup(connection: any, backupData: string): Promise<BackupResult> {
  try {
    // Implementation for PostgreSQL restore
    return { success: true, error: "PostgreSQL restore not yet implemented" };
  } catch (error) {
    return { success: false, error: `PostgreSQL restore failed: ${error}` };
  }
}

export async function restoreSqliteBackup(connection: any, backupData: string): Promise<BackupResult> {
  try {
    // Implementation for SQLite restore
    return { success: true, error: "SQLite restore not yet implemented" };
  } catch (error) {
    return { success: false, error: `SQLite restore failed: ${error}` };
  }
}

export async function restoreMongoBackup(connection: any, backupData: string): Promise<BackupResult> {
  try {
    // Implementation for MongoDB restore
    return { success: true, error: "MongoDB restore not yet implemented" };
  } catch (error) {
    return { success: false, error: `MongoDB restore failed: ${error}` };
  }
} 