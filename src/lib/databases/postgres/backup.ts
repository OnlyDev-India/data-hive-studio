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

export class PostgresBackup {
  private connection: any;

  constructor(connection: any) {
    this.connection = connection;
  }

  generateBackupCommands(connectionString: string): BackupCommand[] {
    const timestamp = new Date().toISOString().split('T')[0];
    const url = new URL(connectionString);
    const dbName = url.pathname.slice(1);
    const host = url.hostname;
    const port = url.port || '5432';
    const username = url.username;
    
    const mainBackupCommand: BackupCommand = {
      command: `pg_dump -h ${host} -p ${port} -U ${username} -d ${dbName} > backup-${timestamp}.sql`,
      description: "Create a full database backup",
      additionalCommands: [
        {
          command: `pg_dump -h ${host} -p ${port} -U ${username} -d ${dbName} --schema-only > schema-${timestamp}.sql`,
          description: "Backup schema only (no data)"
        },
        {
          command: `pg_dump -h ${host} -p ${port} -U ${username} -d ${dbName} --data-only > data-${timestamp}.sql`,
          description: "Backup data only (no schema)"
        },
        {
          command: `pg_dump -h ${host} -p ${port} -U ${username} -d ${dbName} -Fc > backup-${timestamp}.dump`,
          description: "Create compressed custom format backup"
        },
        {
          command: `pg_dump -h ${host} -p ${port} -U ${username} -d ${dbName} --table=table_name > table-${timestamp}.sql`,
          description: "Backup specific table"
        }
      ]
    };

    const restoreCommands: BackupCommand[] = [
      {
        command: `psql -h ${host} -p ${port} -U ${username} -d ${dbName} < backup-${timestamp}.sql`,
        description: "Restore from SQL backup"
      },
      {
        command: `pg_restore -h ${host} -p ${port} -U ${username} -d ${dbName} backup-${timestamp}.dump`,
        description: "Restore from custom format backup"
      },
      {
        command: `psql -h ${host} -p ${port} -U ${username} -d ${dbName} < schema-${timestamp}.sql`,
        description: "Restore schema only"
      }
    ];

    const maintenanceCommands: BackupCommand[] = [
      {
        command: `pg_dumpall -h ${host} -p ${port} -U ${username} > all-databases-${timestamp}.sql`,
        description: "Backup all databases"
      },
      {
        command: `vacuumdb -h ${host} -p ${port} -U ${username} -d ${dbName} --analyze`,
        description: "Analyze and vacuum database"
      }
    ];

    return [mainBackupCommand, ...restoreCommands, ...maintenanceCommands];
  }

  // Legacy methods - kept for compatibility but deprecated
  async createBackup(options: DatabaseBackupOptions): Promise<BackupResult> {
    console.warn('PostgresBackup.createBackup is deprecated. Use generateBackupCommands instead.');
    return {
      success: false,
      error: 'This method is deprecated. Use generateBackupCommands to get terminal commands instead.'
    };
  }

  async getBackupStatistics(): Promise<{ tablesCount: number; recordsCount: number }> {
    try {
      const tables = await this.connection.executeQuery("SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'");
      const tablesCount = tables.data?.[0]?.count || 0;
      
      let totalRecords = 0;
      const tableNames = await this.connection.executeQuery("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
      
      for (const table of tableNames.data || []) {
        const countQuery = `SELECT COUNT(*) as count FROM "${table.table_name}"`;
        const result = await this.connection.executeQuery(countQuery);
        totalRecords += result.data?.[0]?.count || 0;
      }
      
      return { 
        tablesCount, 
        recordsCount: totalRecords 
      };
    } catch (error) {
      console.error('Error getting backup statistics:', error);
      return { tablesCount: 0, recordsCount: 0 };
    }
  }
} 