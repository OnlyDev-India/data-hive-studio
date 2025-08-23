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

export interface BackupCommand {
  command: string;
  description: string;
  additionalCommands?: BackupCommand[];
}

export class SqliteBackup {
  private connection: any;

  constructor(connection: any) {
    this.connection = connection;
  }

  generateBackupCommands(connectionString: string): BackupCommand[] {
    const timestamp = new Date().toISOString().split('T')[0];
    const dbPath = connectionString.replace('file:', '');
    
    const mainBackupCommand: BackupCommand = {
      command: `cp "${dbPath}" "./backup-${timestamp}.db"`,
      description: "Create a full database backup",
      additionalCommands: [
        {
          command: `sqlite3 "${dbPath}" ".dump" > backup-${timestamp}.sql`,
          description: "Export database to SQL format"
        },
        {
          command: `sqlite3 "${dbPath}" ".schema" > schema-${timestamp}.sql`,
          description: "Export schema only"
        },
        {
          command: `sqlite3 "${dbPath}" "SELECT * FROM table_name;" > table-${timestamp}.csv`,
          description: "Export specific table to CSV"
        }
      ]
    };

    const restoreCommands: BackupCommand[] = [
      {
        command: `cp "./backup-${timestamp}.db" "${dbPath}"`,
        description: "Restore from backup file"
      },
      {
        command: `sqlite3 "${dbPath}" < backup-${timestamp}.sql`,
        description: "Restore from SQL backup"
      }
    ];

    const maintenanceCommands: BackupCommand[] = [
      {
        command: `sqlite3 "${dbPath}" "VACUUM;"`,
        description: "Vacuum database to reclaim space"
      },
      {
        command: `sqlite3 "${dbPath}" "ANALYZE;"`,
        description: "Analyze database for query optimization"
      },
      {
        command: `sqlite3 "${dbPath}" "PRAGMA integrity_check;"`,
        description: "Check database integrity"
      }
    ];

    return [mainBackupCommand, ...restoreCommands, ...maintenanceCommands];
  }

  // Legacy methods - kept for compatibility but deprecated
  async createBackup(options: DatabaseBackupOptions): Promise<BackupResult> {
    console.warn('SqliteBackup.createBackup is deprecated. Use generateBackupCommands instead.');
    return {
      success: false,
      error: 'This method is deprecated. Use generateBackupCommands to get terminal commands instead.'
    };
  }

  async getBackupStatistics(): Promise<{ tablesCount: number; recordsCount: number }> {
    try {
      const tablesResult = await this.connection.executeQuery("SELECT name FROM sqlite_master WHERE type='table'");
      const tables = tablesResult.data || [];
      let totalRecords = 0;
      
      for (const table of tables) {
        const countResult = await this.connection.executeQuery(`SELECT COUNT(*) as count FROM "${table.name}"`);
        totalRecords += countResult.data?.[0]?.count || 0;
      }
      
      return { 
        tablesCount: tables.length, 
        recordsCount: totalRecords 
      };
    } catch (error) {
      console.error('Error getting backup statistics:', error);
      return { tablesCount: 0, recordsCount: 0 };
    }
  }
} 