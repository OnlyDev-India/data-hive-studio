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

export class MongoBackup {
  private connection: any;

  constructor(connection: any) {
    this.connection = connection;
  }

  generateBackupCommands(connectionString: string): BackupCommand[] {
    const timestamp = new Date().toISOString().split('T')[0];
    const dbName = connectionString.split('/').pop()?.split('?')[0] || 'database';
    
    const mainBackupCommand: BackupCommand = {
      command: `mongodump --uri="${connectionString}" --out=./backup-${timestamp}`,
      description: "Create a full database backup",
      additionalCommands: [
        {
          command: `mongodump --uri="${connectionString}" --db=${dbName} --collection=collection_name --out=./backup-${timestamp}`,
          description: "Backup specific collection"
        },
        {
          command: `mongodump --uri="${connectionString}" --db=${dbName} --gzip --out=./backup-${timestamp}`,
          description: "Create compressed backup"
        },
        {
          command: `mongodump --uri="${connectionString}" --db=${dbName} --query='{"field": "value"}' --out=./backup-${timestamp}`,
          description: "Backup with query filter"
        }
      ]
    };

    const restoreCommands: BackupCommand[] = [
      {
        command: `mongorestore --uri="${connectionString}" ./backup-${timestamp}`,
        description: "Restore from backup directory"
      },
      {
        command: `mongorestore --uri="${connectionString}" --db=${dbName} ./backup-${timestamp}/${dbName}`,
        description: "Restore specific database"
      }
    ];

    const exportCommands: BackupCommand[] = [
      {
        command: `mongoexport --uri="${connectionString}" --collection=collection_name --out=collection-${timestamp}.json`,
        description: "Export collection to JSON"
      },
      {
        command: `mongoexport --uri="${connectionString}" --collection=collection_name --type=csv --fields=field1,field2 --out=collection-${timestamp}.csv`,
        description: "Export collection to CSV"
      }
    ];

    return [mainBackupCommand, ...restoreCommands, ...exportCommands];
  }

  // Legacy methods - kept for compatibility but deprecated
  async createBackup(options: DatabaseBackupOptions): Promise<BackupResult> {
    console.warn('MongoBackup.createBackup is deprecated. Use generateBackupCommands instead.');
    return {
      success: false,
      error: 'This method is deprecated. Use generateBackupCommands to get terminal commands instead.'
    };
  }

  async createBackupWithOptions(options: DatabaseBackupOptions): Promise<BackupResult> {
    console.warn('MongoBackup.createBackupWithOptions is deprecated. Use generateBackupCommands instead.');
    return {
      success: false,
      error: 'This method is deprecated. Use generateBackupCommands to get terminal commands instead.'
    };
  }

  async createBSONBackup(): Promise<BackupResult> {
    console.warn('MongoBackup.createBSONBackup is deprecated. Use generateBackupCommands instead.');
    return {
      success: false,
      error: 'This method is deprecated. Use generateBackupCommands to get terminal commands instead.'
    };
  }

  async getBackupStatistics(): Promise<{ tablesCount: number; recordsCount: number }> {
    try {
      const collections = await this.connection.getCollections();
      let totalRecords = 0;
      
      for (const collection of collections) {
        const documents = await this.connection.getCollectionData(collection.name);
        totalRecords += documents.length;
      }
      
      return { 
        tablesCount: collections.length, 
        recordsCount: totalRecords 
      };
    } catch (error) {
      console.error('Error getting backup statistics:', error);
      return { tablesCount: 0, recordsCount: 0 };
    }
  }
} 