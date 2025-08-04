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

export class PostgresBackup {
  private connection: any;

  constructor(connection: any) {
    this.connection = connection;
  }

  async createBackup(options: DatabaseBackupOptions): Promise<BackupResult> {
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const fileName = `postgres-backup-${timestamp}.sql`;
      
      let backupContent = '';
      let tablesCount = 0;
      let recordsCount = 0;

      // Get all tables
      const tablesResult = await this.connection.executeQuery(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
      );
      
      const tables = tablesResult.data || [];

      for (const table of tables) {
        tablesCount++;
        const tableName = table.table_name;
        
        if (options.includeSchema) {
          backupContent += this.generateSchemaSQL(tableName);
        }
        
        if (options.includeData) {
          const dataResult = await this.connection.executeQuery(`SELECT * FROM "${tableName}"`);
          const records = dataResult.data || [];
          recordsCount += records.length;
          backupContent += this.generateDataSQL(tableName, records);
        }
        
        if (options.includeIndexes) {
          backupContent += this.generateIndexesSQL(tableName);
        }
        
        if (options.includeConstraints) {
          backupContent += this.generateConstraintsSQL(tableName);
        }
      }

      return {
        success: true,
        data: backupContent,
        fileName,
        backupSize: backupContent.length,
        tablesCount,
        recordsCount
      };
    } catch (error) {
      return { 
        success: false, 
        error: `PostgreSQL backup failed: ${error}` 
      };
    }
  }

  private async generateSchemaSQL(tableName: string): Promise<string> {
    try {
      const schemaResult = await this.connection.executeQuery(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = '${tableName}' AND table_schema = 'public'
        ORDER BY ordinal_position
      `);
      
      let schemaSQL = `\n-- Table structure for ${tableName}\n`;
      schemaSQL += `CREATE TABLE "${tableName}" (\n`;
      
      const columns = schemaResult.data || [];
      const columnDefs = columns.map((col: any) => {
        let def = `  "${col.column_name}" ${col.data_type}`;
        if (col.is_nullable === 'NO') def += ' NOT NULL';
        if (col.column_default) def += ` DEFAULT ${col.column_default}`;
        return def;
      });
      
      schemaSQL += columnDefs.join(',\n') + '\n);\n';
      return schemaSQL;
    } catch (error) {
      console.error(`Error generating schema for ${tableName}:`, error);
      return '';
    }
  }

  private generateDataSQL(tableName: string, records: any[]): string {
    if (records.length === 0) return '';
    
    let dataSQL = `\n-- Data for ${tableName}\n`;
    dataSQL += `INSERT INTO "${tableName}" VALUES\n`;
    
    const values = records.map(record => {
      const rowValues = Object.values(record).map(value => {
        if (value === null) return 'NULL';
        if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
        return String(value);
      });
      return `(${rowValues.join(', ')})`;
    });
    
    dataSQL += values.join(',\n') + ';\n';
    return dataSQL;
  }

  private async generateIndexesSQL(tableName: string): Promise<string> {
    try {
      const indexesResult = await this.connection.executeQuery(`
        SELECT indexname, indexdef
        FROM pg_indexes 
        WHERE tablename = '${tableName}' AND schemaname = 'public'
      `);
      
      let indexesSQL = '';
      const indexes = indexesResult.data || [];
      
      for (const index of indexes) {
        indexesSQL += `${index.indexdef};\n`;
      }
      
      return indexesSQL;
    } catch (error) {
      console.error(`Error generating indexes for ${tableName}:`, error);
      return '';
    }
  }

  private async generateConstraintsSQL(tableName: string): Promise<string> {
    try {
      const constraintsResult = await this.connection.executeQuery(`
        SELECT conname, contype, pg_get_constraintdef(oid) as constraint_def
        FROM pg_constraint 
        WHERE conrelid = '${tableName}'::regclass
      `);
      
      let constraintsSQL = '';
      const constraints = constraintsResult.data || [];
      
      for (const constraint of constraints) {
        constraintsSQL += `ALTER TABLE "${tableName}" ADD CONSTRAINT "${constraint.conname}" ${constraint.constraint_def};\n`;
      }
      
      return constraintsSQL;
    } catch (error) {
      console.error(`Error generating constraints for ${tableName}:`, error);
      return '';
    }
  }

  async getBackupStatistics(): Promise<{ tablesCount: number; recordsCount: number }> {
    try {
      const tablesResult = await this.connection.executeQuery(
        "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'"
      );
      const tablesCount = tablesResult.data?.[0]?.count || 0;
      
      let totalRecords = 0;
      const tables = await this.connection.executeQuery(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
      );
      
      for (const table of tables.data || []) {
        const countResult = await this.connection.executeQuery(`SELECT COUNT(*) as count FROM "${table.table_name}"`);
        totalRecords += countResult.data?.[0]?.count || 0;
      }
      
      return { tablesCount, recordsCount: totalRecords };
    } catch (error) {
      console.error('Error getting backup statistics:', error);
      return { tablesCount: 0, recordsCount: 0 };
    }
  }
} 