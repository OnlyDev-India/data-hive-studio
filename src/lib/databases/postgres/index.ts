import {
  Client,
  FieldDef,
  Pool,
  types,
  QueryResult as PgQueryResult,
} from "pg";
import { identify } from "sql-query-identifier";

export class PostgresClient {
  conn: { pool: Pool | null };
  connectionString: string | null;

  constructor() {
    this.conn = { pool: null };
    this.connectionString = null;
  }

  async connectDb({ connectionString }: { connectionString: string }) {
    try {
      const response = await this.testConnection({ connectionString });
      if (!response.success) return response;
      this.conn = { pool: new Pool({ connectionString }) };
      this.connectionString = connectionString;
      if (this.conn.pool) {
        console.log("Connection to the database was successful!");
        return {
          success: true,
          error: null,
        };
      }
      return {
        success: false,
        error: "Connection to the database was not successful!",
      };
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
  async getTablesWithFieldsFromDb() {
    if (!this.conn.pool) return null;
    try {
      // Query to retrieve table names, column names, and their data types from the 'public' schema
      const query = `
                  SELECT c.table_name, c.column_name, c.data_type, tc.constraint_type AS key_type,
                        kcu2.table_name AS foreign_table_name, kcu2.column_name AS foreign_column_name
                  FROM information_schema.columns AS c
                  LEFT JOIN information_schema.key_column_usage AS kcu
                    ON c.table_name = kcu.table_name AND c.column_name = kcu.column_name
                  LEFT JOIN information_schema.table_constraints AS tc
                    ON kcu.constraint_name = tc.constraint_name
                  LEFT JOIN information_schema.referential_constraints AS rc
                    ON rc.constraint_name = kcu.constraint_name 
                  LEFT JOIN information_schema.key_column_usage AS kcu2
                    ON rc.unique_constraint_name = kcu2.constraint_name
                  WHERE c.table_schema = 'public'
                  ORDER BY c.table_name, c.ordinal_position;
              `;

      // Execute the query
      const columns = await this.conn.pool.query(query);

      // Organize the results into a structured format
      const tableFieldsMap: {
        [key: string]: {
          name: string;
          type: string;
          key_type: string;
          foreign_table_name: string;
          foreign_column_name: string;
        }[];
      } = {};
      columns.rows.forEach((row: any) => {
        if (!tableFieldsMap[row.table_name]) {
          tableFieldsMap[row.table_name] = [];
        }
        tableFieldsMap[row.table_name].push({
          name: row.column_name,
          type: row.data_type,
          key_type: row.key_type,
          foreign_table_name: row.foreign_table_name,
          foreign_column_name: row.foreign_column_name,
        });
      });

      // Convert the map to an array of objects
      const result = Object.keys(tableFieldsMap).map((table_name) => ({
        table_name,
        fields: tableFieldsMap[table_name],
      }));

      return result;
    } catch (error) {
      console.error("Error retrieving tables with fields and types:", error);
      return null;
    }
  }

  async getTablesData(
    tableName: string
  ): Promise<{ data: any; error: string | null }> {
    if (!this.conn.pool) {
      return { data: null, error: "No connection to the database" };
    }

    try {
      // Query to retrieve table names, column names, and their data types from the 'public' schema

      const query = `
                SELECT *
                FROM public."${tableName}";
            `;

      // Execute the query
      const columns = await this.conn.pool.query(query);

      return { data: columns.rows, error: null };
    } catch (error: any) {
      console.error("Error:", error);
      return { data: null, error: error.message };
    }
  }
  async getTableColumns(tableName: string): Promise<{ columns: any | null }> {
    if (!this.conn.pool) {
      return { columns: null };
    }

    try {
      // Query to retrieve column names from the 'public' schema
      const query = `
        SELECT c.column_name, c.data_type, c.column_default, tc.constraint_type AS key_type,
               tc.table_name AS foreign_table_name, (
          SELECT kcu2.table_name
          FROM information_schema.key_column_usage AS kcu2
          WHERE kcu2.constraint_name = rc.unique_constraint_name LIMIT 1
        ) AS to_table
        FROM information_schema.columns AS c
        LEFT JOIN information_schema.key_column_usage AS kcu
          ON c.table_name = kcu.table_name AND c.column_name = kcu.column_name
        LEFT JOIN information_schema.table_constraints AS tc
          ON kcu.constraint_name = tc.constraint_name AND tc.table_name = tc.table_name
        LEFT JOIN
        information_schema.referential_constraints AS rc
          ON rc.constraint_name = kcu.constraint_name 
        WHERE c.table_name = $1
        AND c.table_schema = 'public'
        ORDER BY c.ordinal_position;
      `;

      // Execute the query with the table name as a parameter
      const columns = await this.conn.pool.query(query, [tableName]);

      return {
        columns: columns.rows.map((row: any) => ({
          column_name: row.column_name,
          data_type: row.data_type,
          key_type: row.key_type,
          foreign_table_name: row.to_table || null, // Include foreign table name if exists
          column_default: row.column_default,
        })),
      };
    } catch (error) {
      console.error("Error fetching columns:", error);
      return { columns: null };
    }
  }
  async getTableRelations(tableName: string) {
    if (!this.conn.pool) {
      return { data: null, error: "No connection to the database" };
    }

    try {
      // Query to retrieve table columns those are foreign keys and give the fields like column_name, referenced_table_name, referenced_column_name, onUpdate, onDelete
      const query = `
        SELECT
          kcu.column_name AS column_name,
          kcu2.table_name AS referenced_table_name,
          kcu2.column_name AS referenced_column_name,
          rc.update_rule AS onUpdate,
          rc.delete_rule AS onDelete
        FROM
          information_schema.key_column_usage AS kcu
        JOIN
          information_schema.table_constraints AS tc
          ON kcu.constraint_name = tc.constraint_name
        JOIN
          information_schema.referential_constraints AS rc
          ON tc.constraint_name = rc.constraint_name
        JOIN
          information_schema.key_column_usage AS kcu2
          ON rc.unique_constraint_name = kcu2.constraint_name
        WHERE
          tc.table_name = $1
          AND kcu.table_schema = 'public'
          AND kcu2.table_schema = 'public'
        ORDER BY
          kcu.ordinal_position;
      `;

      // Execute the query with the table name as a parameter
      const columns = await this.conn.pool.query(query, [tableName]);

      const data = columns.rows.map((row: any) => ({
        column_name: row.column_name,
        referenced_table_name: row.referenced_table_name,
        referenced_column_name: row.referenced_column_name,
        onUpdate: row.onUpdate || null,
        onDelete: row.onDelete || null,
      }));
      return { data, error: null };
    } catch (error: any) {
      console.error("Error fetching columns:", error);
      return { data: null, error: error.message };
    }
  }
  async dropTable(table_name: string) {
    if (!this.conn.pool) {
      return { data: null, error: "No connection to the database" };
    }

    try {
      // Query to drop the table
      const query = `
        DROP TABLE IF EXISTS "${table_name}";
      `;

      // Execute the query
      await this.conn.pool.query(query);

      return { data: null, error: null };
    } catch (error: any) {
      console.error("Error dropping table:", error);
      return { data: null, error: error.message };
    }
  }

  identifyCommands(query: string) {
    try {
      return identify(query);
    } catch (err) {
      return [];
    }
  }

  async executeQuery(query: string) {
    if (!this.conn.pool) {
      return {
        data: null,
        message: null,
        isTableEffected: false,
        error: "No connection to the database",
      };
    }
    try {
      // Execute the query
      const result = await this.conn.pool.query(query);

      const commands = this.identifyCommands(query).map((item) => item.type);

      // Check if there is any query other than select
      const isTableEffected =
        commands.filter((item) => item !== "SELECT").length > 0;

      if (Array.isArray(result)) {
        return {
          data: { rows: [], columns: [] },
          message: result.length + " Query executed successfully",
          isTableEffected,
          error: null,
        };
      }

      const columns = result.fields?.map((field: any) => {
        Object.keys(types.builtins).find((type: any) => {
          return types.builtins[type] === field.type;
        });

        return {
          column_name: field.name,
          data_type:
            Object.keys(types.builtins)
              .find((type: any) => {
                return types.builtins[type] === field.dataTypeID;
              })
              ?.toLowerCase() || "USER-DEFINED",
        };
      });
      return {
        data: { rows: result.rows, columns: columns || [] },
        message: null,
        isTableEffected,
        error: null,
      };
    } catch (error: any) {
      console.error("Error:", error);
      return {
        data: null,
        message: null,
        isTableEffected: false,
        error: error.message,
      };
    }
  }

  async testConnection({ connectionString }: { connectionString: string }) {
    try {
      const client = new Client(connectionString);
      await client.connect();
      await client.end();
      return { success: true, error: null };
    } catch (error: any) {
      console.error("Error:", error);
      return { success: false, error: error.message };
    }
  }
}
