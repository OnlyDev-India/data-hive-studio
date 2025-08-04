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

export class SqliteBackup {
  private connection: any;

  constructor(connection: any) {
    this.connection = connection;
  }

  async createBackup(options: DatabaseBackupOptions): Promise<BackupResult> {
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const fileName = `sqlite-backup-${timestamp}.sql`;
      
      let backupContent = '';
      let tablesCount = 0;
      let recordsCount = 0;

      // Get all tables
      const tablesResult = await this.connection.executeQuery(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      
      const tables = tablesResult.data || [];

      for (const table of tables) {
        tablesCount++;
        const tableName = table.name;
        
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
        error: `SQLite backup failed: ${error}` 
      };
    }
  }

  private async generateSchemaSQL(tableName: string): Promise<string> {
    try {
      const schemaResult = await this.connection.executeQuery(`PRAGMA table_info("${tableName}")`);
      
      let schemaSQL = `\n-- Table structure for ${tableName}\n`;
      schemaSQL += `CREATE TABLE "${tableName}" (\n`;
      
      const columns = schemaResult.data || [];
      const columnDefs = columns.map((col: any) => {
        let def = `  "${col.name}" ${col.type}`;
        if (col.notnull) def += ' NOT NULL';
        if (col.dflt_value) def += ` DEFAULT ${col.dflt_value}`;
        if (col.pk) def += ' PRIMARY KEY';
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
        SELECT name, sql FROM sqlite_master 
        WHERE type='index' AND tbl_name='${tableName}'
      `);
      
      let indexesSQL = '';
      const indexes = indexesResult.data || [];
      
      for (const index of indexes) {
        if (index.sql) {
          indexesSQL += `${index.sql};\n`;
        }
      }
      
      return indexesSQL;
    } catch (error) {
      console.error(`Error generating indexes for ${tableName}:`, error);
      return '';
    }
  }

  private async generateConstraintsSQL(tableName: string): Promise<string> {
    try {
      // SQLite constraints are part of the table definition
      // This would extract foreign key constraints
      const fkResult = await this.connection.executeQuery(`PRAGMA foreign_key_list("${tableName}")`);
      
      let constraintsSQL = '';
      const constraints = fkResult.data || [];
      
      for (const constraint of constraints) {
        constraintsSQL += `-- Foreign key constraint: ${constraint.from} -> ${constraint.table}.${constraint.to}\n`;
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
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      const tablesCount = tablesResult.data?.[0]?.count || 0;
      
      let totalRecords = 0;
      const tables = await this.connection.executeQuery(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      
      for (const table of tables.data || []) {
        const countResult = await this.connection.executeQuery(`SELECT COUNT(*) as count FROM "${table.name}"`);
        totalRecords += countResult.data?.[0]?.count || 0;
      }
      
      return { tablesCount, recordsCount: totalRecords };
    } catch (error) {
      console.error('Error getting backup statistics:', error);
      return { tablesCount: 0, recordsCount: 0 };
    }
  }

  async createFullDump(): Promise<BackupResult> {
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const fileName = `sqlite-full-dump-${timestamp}.sql`;
      
      // Get the database file path and create a full dump
      const dumpResult = await this.connection.executeQuery('.dump');
      
      return {
        success: true,
        data: dumpResult.data || '',
        fileName,
        backupSize: (dumpResult.data || '').length,
        tablesCount: 0,
        recordsCount: 0
      };
    } catch (error) {
      return { 
        success: false, 
        error: `SQLite full dump failed: ${error}` 
      };
    }
  }
} 