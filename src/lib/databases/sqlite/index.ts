import { testConnection } from "@/lib/actions/fetch-data";
import sqlite3 from "sqlite3";
import { Database, open } from "sqlite";

export class SqliteClient {
  conn: { pool: Database | null };
  connectionString: string | null;

  constructor() {
    this.conn = { pool: null };
    this.connectionString = null;
  }

  async connectDb({ connectionString }: { connectionString: string }) {
    try {
      if (!this.conn.pool) {
        this.conn.pool = await open({
          filename: connectionString,
          driver: sqlite3.Database,
        });
        return {
          success: true,
          error: null,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
  isConnectedToDb() {
    return this.conn.pool;
  }

  async executeQuery(query: string) {
    if (!this.conn.pool) {
      return {
        data: null,
        message: null,
        error: "No connection to the database",
      };
    }
    try {
      const queries = query
        .split(";")
        .map((q) => q.trim())
        .filter((q) => q);
      const results = [];

      for (const query of queries) {
        if (query.toLowerCase().startsWith("select")) {
          // Use `all` for SELECT queries
          const result = await this.conn.pool.all(query);
          results.push(result);
        } else {
          // Use `run` for other queries
          const result = await this.conn.pool.run(query);
          results.push({ affectedRows: result.changes });
        }
      }

      if (results.length > 1) {
        return {
          data: { rows: results },
          message: results.length + " Query executed successfully",
          error: null,
        };
      }

      return {
        data: { rows: results[0] },
        message: "Query executed successfully",
        error: null,
      };
    } catch (error: any) {
      return {
        data: null,
        message: null,
        error: error.message,
      };
    }
  }

  async testConnection({ connectionString }: { connectionString: string }) {
    try {
      const client = new sqlite3.Database(connectionString);
      await client.run("SELECT 1");
      await client.close();
      return { success: true, error: null };
    } catch (error: any) {
      console.error("Error:", error);
      return { success: false, error: error.message };
    }
  }

  async getTablesWithFieldsFromDb() {
    return false as any;
  }
  async getTableRelations(table_name: string) {
    return false as any;
  }
  async getTableColumns(table_name: string) {
    return false as any;
  }
  async getTablesData(table_name: string) {
    return false as any;
  }
  async dropTable(tableName: string) {
    return false as any;
  }
  async updateTable(
    tableName: string,
    data: Array<{
      oldValue: Record<string, any>;
      newValue: Record<string, any>;
    }>
  ) {
    return false as any;
  }
  async deleteTableData(tableName: string, data: any[]) {
    return false as any;
  }
}
