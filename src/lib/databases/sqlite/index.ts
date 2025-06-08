import sqlite3 from "sqlite3";
import { Database, open } from "sqlite";
import { ConnectionDetailsType, DatabaseClient } from "@/types/db.type";
import { TableForm } from "@/types/table.type";

export class SqliteClient implements DatabaseClient {
  private db: Database | null = null;

  async connectDb({ connectionDetails }: { connectionDetails: ConnectionDetailsType }) {
    try {
      this.db = await open({
        filename: connectionDetails.connection_string,
        driver: sqlite3.Database
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to connect to SQLite",
      };
    }
  }

  async disconnect() {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  isConnectedToDb() {
    return this.db !== null;
  }

  async executeQuery(query: string, params?: any[]) {
    if (!this.db) {
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
          // Use `all` for SELECT queries with params if provided
          const result = params ? await this.db.all(query, params) : await this.db.all(query);
          results.push(result);
        } else {
          // Use `run` for other queries with params if provided
          const result = params ? await this.db.run(query, params) : await this.db.run(query);
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

  async testConnection({
    connectionDetails,
  }: {
    connectionDetails: ConnectionDetailsType;
  }) {
    try {
      const uri = connectionDetails.connection_string;
      if (!uri) {
        return { success: false, error: "Connection string not found" };
      }
      const client = new sqlite3.Database(uri);
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
    }>,
  ) {
    return false as any;
  }
  async deleteTableData(tableName: string, data: any[]) {
    return false as any;
  }
  async insertRecord(data: { tableName: string; values: any[][] }) {
    return false as any;
  }

  async getDatabases() {
    return { databases: [], error: null };
  }

  async getSchemas() {
    return { schemas: [], error: null };
  }

  async createTable(data: TableForm) {
    if (!this.db) return { data: null, error: "Not connected to database" };
    if (!data.columns || data.columns.length === 0) {
      return { data: null, error: "No columns provided" };
    }
    try {
      const columns = data.columns.map(col => {
        const constraints = [];
        if (!col.isNull) constraints.push("NOT NULL");
        if (col.defaultValue) constraints.push(`DEFAULT ${col.defaultValue}`);
        if (col.keyType === "PRIMARY") constraints.push("PRIMARY KEY");
        return `"${col.name}" ${col.type} ${constraints.join(" ")}`;
      }).join(", ");

      const query = `CREATE TABLE IF NOT EXISTS "${data.name}" (${columns})`;
      await this.db.exec(query);
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : "Failed to create table" };
    }
  }
}
