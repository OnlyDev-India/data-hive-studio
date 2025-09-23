import { ConnectionDetailsType } from "@/types/db.type";
import { DatabaseClient } from "@/lib/databases/database-client";
import { PaginationType } from "@/types/file.type";
import { FilterType, TableForm } from "@/types/table.type";
import { Client, Pool, types } from "pg";
import { SortColumn } from "react-data-grid";
import { identify } from "sql-query-identifier";

export class PostgresClient extends DatabaseClient {
  private pool: Pool | null = null;
  currentSchema: string;

  constructor() {
    super();
    this.currentSchema = "public";
  }

  // Destructor to ensure connections are closed when object is garbage collected
  public destroy() {
    this.disconnect();
  }

  // Finalizer for serverless environments
  public finalize() {
    this.disconnect();
  }

  async connectDb({
    connectionDetails,
  }: {
    connectionDetails: ConnectionDetailsType;
  }) {
    try {
      this.pool = new Pool({
        user: connectionDetails.username,
        host: connectionDetails.host,
        database:
          connectionDetails.database || connectionDetails.connection_string,
        password: connectionDetails.password,
        port: connectionDetails.port,
        ssl: connectionDetails.ssl || false,
      });

      // Test the connection
      const client = await this.pool.connect();
      client.release();

      this.setConnectionDetails(connectionDetails);
      this.isConnected = true;

      return this.createSuccessResponse();
    } catch (error) {
      return this.handleError(error, "connectDb");
    }
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
      this.connectionDetails = null;
    }
  }

  async getTablesWithFieldsFromDb(
    currentSchema: string,
    isUpdateSchema = false,
  ) {
    if (!this.pool)
      return { tables: [], error: "No connection to the database" };
    try {
      if (isUpdateSchema) {
        this.currentSchema = currentSchema;
      }

      // Query to retrieve table names, column names, and their data types from the 'public' schema
      // Modified to avoid duplicates by aggregating constraints
      const query = `
                  SELECT 
                    c.table_name, 
                    c.column_name, 
                    c.data_type, 
                    STRING_AGG(DISTINCT tc.constraint_type, ', ') AS key_type,
                    STRING_AGG(DISTINCT kcu2.table_name, ', ') AS foreign_table_name, 
                    STRING_AGG(DISTINCT kcu2.column_name, ', ') AS foreign_column_name
                  FROM information_schema.columns AS c
                  LEFT JOIN information_schema.key_column_usage AS kcu
                    ON c.table_name = kcu.table_name AND c.column_name = kcu.column_name
                    AND c.table_schema = kcu.table_schema
                  LEFT JOIN information_schema.table_constraints AS tc
                    ON kcu.constraint_name = tc.constraint_name
                    AND tc.table_schema = c.table_schema
                  LEFT JOIN information_schema.referential_constraints AS rc
                    ON rc.constraint_name = kcu.constraint_name 
                    AND rc.constraint_schema = c.table_schema
                  LEFT JOIN information_schema.key_column_usage AS kcu2
                    ON rc.unique_constraint_name = kcu2.constraint_name
                    AND rc.unique_constraint_schema = kcu2.table_schema
                  WHERE c.table_schema = '${currentSchema}'
                  GROUP BY c.table_name, c.column_name, c.data_type, c.ordinal_position
                  ORDER BY c.table_name, c.ordinal_position;
              `;

      // Execute the query
      const columns = await this.pool.query(query);

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

      return { tables: result, error: null };
    } catch (error: any) {
      console.error("Error retrieving tables with fields and types:", error);
      return { tables: [], error: error.message };
    }
  }

  async getDatabases() {
    if (!this.pool) {
      return { databases: [], error: "No connection to the database" };
    }

    try {
      // Query to retrieve all databases
      const query = `SELECT datname AS database_name
                      FROM pg_database
                      WHERE datistemplate = false
                        AND datname NOT IN ('postgres');`;

      // Execute the query
      const columns = await this.pool.query(query);

      return { databases: columns.rows || [], error: null };
    } catch (error: any) {
      console.error("Error retrieving databases:", error);
      return { databases: [], error: error.message };
    }
  }

  async getSchemas() {
    if (!this.pool) {
      return { schemas: [], error: "No connection to the database" };
    }

    try {
      // Query to All schemas
      const query = `SELECT nspname AS schema_name
                FROM pg_namespace
                WHERE nspname NOT LIKE 'pg_%'
                AND nspname != 'information_schema';
                `;

      // Execute the query
      const columns = await this.pool.query(query);

      return { schemas: columns.rows || [], error: null };
    } catch (error: any) {
      console.error("Error retrieving schemas:", error);
      return { schemas: [], error: error.message };
    }
  }

  async getTablesData(
    tableName: string,
    options?: {
      filters?: FilterType[];
      orderBy?: SortColumn[];
      pagination?: PaginationType;
    },
  ): Promise<{
    data: any;
    error: string | null;
    totalRecords: number;
    columns: any[];
  }> {
    if (!this.pool) {
      return {
        data: null,
        error: "No connection to the database",
        totalRecords: 0,
        columns: [],
      };
    }

    try {
      // First get column information
      const columnQuery = `
        SELECT 
          c.column_name,
          c.data_type,
          c.column_default,
          c.is_nullable,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale,
          tc.constraint_type,
          kcu2.table_name AS foreign_table_name,
          kcu2.column_name AS foreign_column_name
        FROM information_schema.columns c
        LEFT JOIN information_schema.key_column_usage kcu
          ON c.table_name = kcu.table_name 
          AND c.column_name = kcu.column_name
        LEFT JOIN information_schema.table_constraints tc
          ON kcu.constraint_name = tc.constraint_name
        LEFT JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = kcu.constraint_name
        LEFT JOIN information_schema.key_column_usage kcu2
          ON rc.unique_constraint_name = kcu2.constraint_name
        WHERE c.table_schema = '${this.currentSchema}'
          AND c.table_name = '${tableName}'
        ORDER BY c.ordinal_position;
      `;

      const columnsResult = await this.pool.query(columnQuery);
      const columns = columnsResult.rows.map((col: any) => ({
        name: col.column_name,
        type: col.data_type,
        default: col.column_default,
        nullable: col.is_nullable === "YES",
        maxLength: col.character_maximum_length,
        precision: col.numeric_precision,
        scale: col.numeric_scale,
        constraint: col.constraint_type,
        foreignTable: col.foreign_table_name,
        foreignColumn: col.foreign_column_name,
      }));

      // Then get the data with filters, ordering, and pagination
      let whereQuery = "";
      if (options) {
        const { filters, orderBy, pagination } = options;
        if (filters) {
          whereQuery = this.generateWhereQuery(filters) || "";
        }
        if (orderBy && orderBy?.length > 0) {
          const { columnKey, direction } = orderBy[0];
          whereQuery += ` ORDER BY "${columnKey}" ${direction}`;
        }
        if (pagination) {
          const { page, limit } = pagination;
          whereQuery += ` LIMIT ${limit} OFFSET ${+(page - 1) * limit}`;
        }
      }

      const query = `
        SELECT *
        FROM ${this.currentSchema}."${tableName}"
        ${whereQuery};
      `;

      const totalRecordsQuery = `SELECT COUNT(*) FROM ${this.currentSchema}."${tableName}";`;

      const [totalRecords, data] = await Promise.all([
        this.pool.query(totalRecordsQuery),
        this.pool.query(query),
      ]);

      return {
        data: data.rows,
        error: null,
        totalRecords: totalRecords?.rows?.[0]?.count || 0,
        columns,
      };
    } catch (error: any) {
      console.error("Error:", error);
      return {
        data: null,
        error: error.message,
        totalRecords: 0,
        columns: [],
      };
    }
  }

  async getTableColumns(tableName: string): Promise<{ columns: any | null }> {
    if (!this.pool) {
      return { columns: null };
    }

    try {
      // Query to retrieve column names from the 'public' schema
      // Modified to aggregate constraints and avoid duplicates
      const query = `
        SELECT 
          c.column_name,
          CASE 
            WHEN c.data_type = 'USER-DEFINED' THEN 
              (SELECT t.typname
               FROM pg_type t
               WHERE t.typname = c.udt_name)
            ELSE c.data_type
          END as data_type,
          c.column_default,
          c.is_nullable,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale,
          STRING_AGG(DISTINCT tc.constraint_type, ', ') AS key_type,
          STRING_AGG(DISTINCT kcu2.table_name, ', ') AS foreign_table_name,
          STRING_AGG(DISTINCT kcu2.column_name, ', ') AS foreign_column_name,
          CASE 
            WHEN c.data_type = 'USER-DEFINED' THEN 
              (SELECT string_agg(enumlabel, ',')
               FROM pg_enum e
               JOIN pg_type t ON t.oid = e.enumtypid
               WHERE t.typname = c.udt_name)
            ELSE NULL
          END as enum_values
        FROM information_schema.columns AS c
        LEFT JOIN information_schema.key_column_usage AS kcu
          ON c.table_name = kcu.table_name 
          AND c.column_name = kcu.column_name
          AND c.table_schema = kcu.table_schema
        LEFT JOIN information_schema.table_constraints AS tc
          ON kcu.constraint_name = tc.constraint_name 
          AND tc.table_schema = c.table_schema
        LEFT JOIN information_schema.referential_constraints AS rc
          ON rc.constraint_name = kcu.constraint_name
          AND rc.constraint_schema = c.table_schema
        LEFT JOIN information_schema.key_column_usage AS kcu2
          ON rc.unique_constraint_name = kcu2.constraint_name
          AND rc.unique_constraint_schema = kcu2.table_schema
        WHERE c.table_name = $1
        AND c.table_schema = '${this.currentSchema}'
        GROUP BY c.column_name, c.data_type, c.column_default, c.is_nullable, 
                 c.character_maximum_length, c.numeric_precision, c.numeric_scale, 
                 c.ordinal_position, c.udt_name
        ORDER BY c.ordinal_position;
      `;

      // Execute the query with the table name as a parameter
      const columns = await this.pool.query(query, [tableName]);

      return {
        columns: columns.rows.map((row: any) => ({
          column_name: row.column_name,
          data_type: row.data_type,
          key_type: row.key_type,
          is_nullable: row.is_nullable,
          column_default: row.column_default,
          character_maximum_length: row.character_maximum_length,
          numeric_precision: row.numeric_precision,
          numeric_scale: row.numeric_scale,
          foreign_table_name: row.foreign_table_name || null,
          foreign_column_name: row.foreign_column_name || null,
          enum_values: row.enum_values ? row.enum_values.split(",") : null,
          is_enum: row.enum_values !== null,
        })),
      };
    } catch (error) {
      console.error("Error fetching columns:", error);
      return { columns: null };
    }
  }
  async getTableRelations(tableName: string) {
    if (!this.pool) {
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
          AND kcu.table_schema = tc.table_schema
        JOIN
          information_schema.referential_constraints AS rc
          ON tc.constraint_name = rc.constraint_name
          AND tc.constraint_schema = rc.constraint_schema
        JOIN
          information_schema.key_column_usage AS kcu2
          ON rc.unique_constraint_name = kcu2.constraint_name
          AND rc.unique_constraint_schema = kcu2.table_schema
        WHERE
          tc.table_name = $1
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.table_schema = 'public'
          AND kcu2.table_schema = 'public'
        ORDER BY
          kcu.ordinal_position;
      `;

      // Execute the query with the table name as a parameter
      const columns = await this.pool.query(query, [tableName]);

      const data = columns.rows.map((row: any) => ({
        column_name: row.column_name,
        referenced_table_name: row.referenced_table_name,
        referenced_column_name: row.referenced_column_name,
        onUpdate: row.onupdate?.toUpperCase() || null,
        onDelete: row.ondelete?.toUpperCase() || null,
      }));
      return { data, error: null };
    } catch (error: any) {
      console.error("Error fetching columns:", error);
      return { data: null, error: error.message };
    }
  }
  async dropTable(table_name: string) {
    if (!this.pool) {
      return { data: null, error: "No connection to the database" };
    }

    try {
      // Query to drop the table
      const query = `
        DROP TABLE IF EXISTS ${this.currentSchema}."${table_name}";
      `;

      // Execute the query
      await this.pool.query(query);

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
    if (!this.pool) {
      return {
        data: null,
        message: null,
        isTableEffected: false,
        effectedRows: 0,
        error: "No connection to the database",
      };
    }
    try {
      // Execute the query
      const result = await this.pool.query(query);

      const commands = this.identifyCommands(query).map((item) => item.type);

      // Check if there is any query other than select
      const isTableEffected =
        commands.filter((item) => item !== "SELECT").length > 0;

      if (Array.isArray(result)) {
        const totalRowCount = result.reduce(
          (sum, res) => sum + res.rowCount,
          0,
        );
        return {
          data: { rows: [], columns: [] },
          message: result.length + " Query executed successfully",
          isTableEffected,
          effectedRows: totalRowCount,
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
        effectedRows: result.rowCount || 0,
        error: null,
      };
    } catch (error: any) {
      console.error("Error:", error);
      return {
        data: null,
        message: null,
        isTableEffected: false,
        effectedRows: 0,
        error: error.message,
      };
    }
  }

  async testConnection(params: { connectionDetails: ConnectionDetailsType }) {
    try {
      const client = new Client({
        user: params.connectionDetails.username,
        host: params.connectionDetails.host,
        database:
          params.connectionDetails.database ||
          params.connectionDetails.connection_string,
        password: params.connectionDetails.password,
        port: params.connectionDetails.port,
        ssl: params.connectionDetails.ssl || false,
      });
      await client.connect();
      await client.end();
      return { success: true };
    } catch (error) {
      console.error("Error:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to connect to PostgreSQL",
      };
    }
  }

  private formatValue(value: any): string {
    if (value === null || value === undefined) {
      return "NULL";
    }

    // Handle function calls like gen_random_uuid()
    if (
      typeof value === "string" &&
      value.includes("(") &&
      value.includes(")")
    ) {
      return value;
    }

    if (typeof value === "string") {
      // Escape single quotes in strings
      return `'${value.replace(/'/g, "''")}'`;
    }

    if (typeof value === "boolean") {
      return value ? "TRUE" : "FALSE";
    }

    return value.toString();
  }

  async insertRecord(data: {
    tableName: string;
    values: { [key: string]: any }[];
  }) {
    try {
      if (!this.pool) {
        throw new Error("Database connection not established");
      }

      if (!data.tableName || !data.values || !data.values.length) {
        throw new Error("Invalid input data");
      }

      // Get column information to check for default values
      const { columns } = await this.getTableColumns(data.tableName);
      if (!columns) {
        throw new Error("Failed to get column information");
      }

      const { tableName, values } = data;

      // Process values with default values
      const processedValues = values.map((row) => {
        const processedRow: { [key: string]: any } = {};
        columns.forEach((col: any, index: number) => {
          // Skip if the column has a function default value
          if (
            col.column_default &&
            col.column_default.includes("(") &&
            col.column_default.includes(")") &&
            (row[index] === null ||
              row[index] === undefined ||
              row[index] === "" ||
              row[index] === col.column_default)
          ) {
            // Remove this field so it uses the default value
            // delete processedRow[col.column_name];
            return;
          }
          // Handle other default values
          else if (
            col.column_default &&
            (row[index] === null ||
              row[index] === undefined ||
              row[index] === "")
          ) {
            const defaultValue = col.column_default.replace(/^'|'$/g, "");
            processedRow[col.column_name] = defaultValue;
          } else {
            processedRow[col.column_name] = row[index];
          }
        });
        return processedRow;
      });

      // Get all unique columns from all rows and sort them
      const allColumns = new Set<string>();
      processedValues.forEach((row) => {
        Object.keys(row).forEach((key) => allColumns.add(key));
      });

      // Convert Set to array and sort to maintain consistent order
      const orderedColumns = Array.from(allColumns).sort();
      const columnsList = orderedColumns.map((col) => `"${col}"`).join(", ");

      const valuesList = processedValues
        .map((row) => {
          // Use the same ordered columns to ensure values match column order
          const values = orderedColumns.map((col) =>
            row[col] === undefined
              ? "DEFAULT"
              : this.formatValue(row[col] ?? null),
          );
          return `(${values.join(", ")})`;
        })
        .join(", ");

      const query = `
        INSERT INTO ${this.currentSchema}."${tableName}" (${columnsList})
        VALUES ${valuesList}
        RETURNING *;
      `;

      const result = await this.executeQuery(query);

      if (result.error) {
        throw new Error(result.error);
      }

      return {
        data: result.data?.rows || null,
        effectedRows: result.effectedRows,
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        effectedRows: 0,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  async updateTable(
    tableName: string,
    updateData: Array<{
      oldValue: Record<string, any>;
      newValue: Record<string, any>;
    }>,
  ) {
    try {
      if (!this.pool) {
        throw new Error("Database connection not established");
      }

      const query = await this.generateUpdateQuery(tableName, updateData);
      if (!query) {
        throw new Error("Failed to generate update query");
      }

      const originalQuery = query.toString();
      const { effectedRows, error: updateError } =
        await this.executeQuery(originalQuery);

      console.log(effectedRows, updateError, originalQuery);
      if (updateError) {
        throw new Error(updateError);
      }

      const { data, error: fetchError } = await this.getTablesData(tableName);

      if (fetchError) {
        throw new Error(fetchError);
      }

      return {
        data,
        effectedRows,
        updateError: null,
        fetchError: null,
      };
    } catch (error) {
      return {
        data: null,
        effectedRows: null,
        updateError:
          error instanceof Error ? error.message : "Unknown error occurred",
        fetchError:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  async generateUpdateQuery(
    tableName: string,
    data: Array<{
      oldValue: Record<string, any>;
      newValue: Record<string, any>;
    }>,
  ) {
    if (!tableName || !data || !data.length) {
      console.error("Invalid inputs");
      return null;
    }

    // Get column information to determine data types, primary keys, and unique constraints
    const { columns } = await this.getTableColumns(tableName);
    const columnTypes = new Map();
    const primaryKeys: string[] = [];
    const uniqueColumns: string[] = [];
    const notNullColumns: string[] = [];

    if (columns) {
      columns.forEach((col: any) => {
        columnTypes.set(col.column_name, col.data_type);

        // Track primary keys
        if (col.key_type === "PRIMARY KEY") {
          primaryKeys.push(col.column_name);
        }

        // Track unique constraints
        if (col.key_type === "UNIQUE" || col.is_unique) {
          uniqueColumns.push(col.column_name);
        }

        // Track NOT NULL columns for better identification
        if (col.is_nullable === "NO") {
          notNullColumns.push(col.column_name);
        }
      });
    }

    const queries = data.map(({ oldValue, newValue }) => {
      if (!oldValue || !newValue) {
        console.error("Each entry must have both oldValue and newValue");
        return null;
      }

      // Find what actually changed by comparing old and new values
      const changedFields: Record<string, any> = {};
      Object.keys(oldValue).forEach((key) => {
        // If the field exists in newValue and is different, include it
        if (key in newValue && newValue[key] !== oldValue[key]) {
          changedFields[key] = newValue[key];
        }
        // If the field doesn't exist in newValue but existed in oldValue, set to NULL
        else if (
          !(key in newValue) &&
          oldValue[key] !== null &&
          oldValue[key] !== undefined
        ) {
          changedFields[key] = null;
        }
      });

      // Also include any new fields that didn't exist in oldValue
      Object.keys(newValue).forEach((key) => {
        if (!(key in oldValue)) {
          changedFields[key] = newValue[key];
        }
      });

      // If nothing changed, skip this update
      if (Object.keys(changedFields).length === 0) {
        return null;
      }

      // Generate SET clause only for changed fields
      const setClauses = Object.keys(changedFields)
        .map((key) => {
          return `"${key}" = ${this.formatValue(changedFields[key])}`;
        })
        .join(", ");

      // Generate WHERE clause using the best available identifier strategy
      let whereFields: string[] = [];

      if (primaryKeys.length > 0) {
        // Strategy 1: Use primary keys (most reliable)
        whereFields = primaryKeys;
      } else if (uniqueColumns.length > 0) {
        // Strategy 2: Use unique constraints (good alternative)
        whereFields = uniqueColumns;
      } else if (oldValue.id && notNullColumns.includes("id")) {
        // Strategy 3: Use 'id' field if it's NOT NULL (common convention)
        whereFields = ["id"];
      } else if (notNullColumns.length > 0) {
        // Strategy 4: Use NOT NULL columns as composite identifier
        // Limit to first 3 NOT NULL columns to avoid overly complex WHERE clauses
        whereFields = notNullColumns.slice(0, 3);
      } else {
        // Strategy 5: Fallback to all non-null fields (least reliable)
        // This should be avoided when possible as it can cause unintended updates
        const nonNullFields = Object.keys(oldValue).filter(
          (key) => oldValue[key] !== null && oldValue[key] !== undefined,
        );

        if (nonNullFields.length === 0) {
          console.error(
            `No valid identifier fields found for table ${tableName}. Cannot safely generate UPDATE query.`,
          );
          return null;
        }

        // Limit to first 5 fields to prevent overly complex WHERE clauses
        whereFields = nonNullFields.slice(0, 5);

        console.warn(
          `Warning: Table ${tableName} has no primary key or unique constraints. Using fallback identifier strategy with fields: ${whereFields.join(", ")}. This may cause unintended updates.`,
        );
      }

      // Ensure we have valid values for all WHERE fields
      const validWhereFields = whereFields.filter(
        (key) => oldValue[key] !== null && oldValue[key] !== undefined,
      );

      if (validWhereFields.length === 0) {
        console.error(
          `No valid values found for WHERE fields: ${whereFields.join(", ")}. Cannot safely generate UPDATE query.`,
        );
        return null;
      }

      // Safety check: Ensure we have enough identifying information
      if (validWhereFields.length < whereFields.length) {
        console.warn(
          `Warning: Some WHERE fields have null/undefined values. Using only valid fields: ${validWhereFields.join(", ")}`,
        );
      }

      const whereClauses = validWhereFields
        .map((key) => {
          const columnType = columnTypes.get(key);
          const value = this.formatValue(oldValue[key]);

          // Fix date formatting for PostgreSQL
          if (
            columnType &&
            (columnType.includes("timestamp") || columnType.includes("date"))
          ) {
            return `"${key}"::date = ${value}::date`;
          }

          return `"${key}" = ${value}`;
        })
        .join(" AND ");

      if (!whereClauses) {
        console.error("No valid WHERE conditions found for update");
        return null;
      }

      // Additional safety check for tables without proper identifiers
      if (primaryKeys.length === 0 && uniqueColumns.length === 0) {
        console.warn(
          `Warning: Table ${tableName} has no primary key or unique constraints. Update query may affect multiple rows: ${whereClauses}`,
        );
      }

      return `UPDATE ${this.currentSchema}."${tableName}" SET ${setClauses} WHERE ${whereClauses};`;
    });

    return queries.filter((query) => query !== null).join("\n");
  }

  async deleteTableData(tableName: string, data: any[]) {
    try {
      if (!this.pool) {
        throw new Error("Database connection not established");
      }

      if (!tableName || !data || !data.length) {
        throw new Error("Invalid input data");
      }

      const query = await this.generateDeleteQuery(tableName, data);
      if (!query) {
        throw new Error("Failed to generate delete query");
      }

      const { effectedRows, error: deleteError } =
        await this.executeQuery(query);

      if (deleteError) {
        throw new Error(deleteError);
      }

      const { data: tableData, error: fetchError } =
        await this.getTablesData(tableName);

      if (fetchError) {
        throw new Error(fetchError);
      }

      return {
        data: tableData,
        effectedRows,
        deleteError: null,
        fetchError: null,
      };
    } catch (error) {
      return {
        data: null,
        effectedRows: 0,
        deleteError:
          error instanceof Error ? error.message : "Unknown error occurred",
        fetchError:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  async generateDeleteQuery(tableName: string, data: any[]) {
    if (!tableName || !data || !data.length) {
      return null;
    }

    // Get column information to determine data types
    const { columns } = await this.getTableColumns(tableName);
    const columnTypes = new Map();
    if (columns) {
      columns.forEach((col: any) => {
        columnTypes.set(col.column_name, col.data_type);
      });
    }

    const queries = data.map((entry) => {
      // Generate WHERE clause
      const whereClauses = Object.keys(entry)
        .map((key) => {
          const columnType = columnTypes.get(key);
          const value = this.formatValue(entry[key]);
          const keyFormat =
            columnType &&
            (columnType.includes("timestamp") || columnType.includes("date"))
              ? `Date("${key}")`
              : `"${key}"`;
          return `${keyFormat} = ${value}`;
        })
        .join(" AND ");

      return `DELETE FROM ${this.currentSchema}."${tableName}" WHERE ${whereClauses};`;
    });

    return queries.join("\n");
  }

  async createTable(formData: any) {
    if (!this.pool)
      return {
        data: null,
        error: "Invalid inputs",
      };
    try {
      if (
        !formData.columns ||
        (formData.columns && formData.columns.length === 0)
      )
        return { data: null, error: "No columns" };

      const currentSchema = this.currentSchema;

      // Validate foreign key references before creating the table
      for (const column of formData.columns) {
        if (
          column.keyType === "FOREIGN KEY" &&
          column.foreignTable &&
          column.foreignTableColumn
        ) {
          // Check if the referenced table exists
          const tableCheckQuery = `
            SELECT column_name, data_type, udt_name
            FROM information_schema.columns 
            WHERE table_schema = $1 
            AND table_name = $2 
            AND column_name = $3
          `;

          const result = await this.pool.query(tableCheckQuery, [
            currentSchema,
            column.foreignTable,
            column.foreignTableColumn,
          ]);

          if (result.rows.length === 0) {
            return {
              data: null,
              error: `Foreign key reference error: Table "${column.foreignTable}" or column "${column.foreignTableColumn}" does not exist`,
            };
          }

          // Check if the data types are compatible
          const referencedColumn = result.rows[0];
          const referencedType = referencedColumn.data_type.toUpperCase();
          const currentType = column.type.toUpperCase();

          // Map of compatible types
          const compatibleTypes: { [key: string]: string[] } = {
            UUID: ["UUID"],
            TEXT: ["TEXT", "VARCHAR", "CHAR", "CHARACTER VARYING"],
            INTEGER: ["INTEGER", "BIGINT", "SMALLINT"],
            BIGINT: ["BIGINT", "INTEGER"],
            SERIAL: ["INTEGER"],
            BIGSERIAL: ["BIGINT"],
            "CHARACTER VARYING": [
              "CHARACTER VARYING",
              "TEXT",
              "VARCHAR",
              "CHAR",
            ],
            VARCHAR: ["VARCHAR", "TEXT", "CHARACTER VARYING", "CHAR"],
            DECIMAL: ["DECIMAL", "NUMERIC"],
            NUMERIC: ["NUMERIC", "DECIMAL"],
            REAL: ["REAL", "DOUBLE PRECISION"],
            "DOUBLE PRECISION": ["DOUBLE PRECISION", "REAL"],
            TIMESTAMP: ["TIMESTAMP", "TIMESTAMPTZ"],
            TIMESTAMPTZ: ["TIMESTAMPTZ", "TIMESTAMP"],
          };

          if (!compatibleTypes[currentType]?.includes(referencedType)) {
            return {
              data: null,
              error: `Foreign key reference error: Column type "${column.type}" is not compatible with referenced column type "${referencedType}" in table "${column.foreignTable}"`,
            };
          }
        }
      }

      // Build column definitions
      const columnDefinitions: string[] = [];
      const primaryKeys: string[] = [];
      const foreignKeys: string[] = [];
      const uniqueColumns: string[] = [];

      formData.columns.forEach((column: any) => {
        const {
          name,
          type,
          isNull,
          defaultValue,
          keyType,
          foreignTable,
          foreignTableColumn,
          length,
          isPrimaryKey,
          isUnique,
          isForeignKey,
        } = column;

        if (!name || !type) {
          throw new Error(
            `Invalid column definition: ${JSON.stringify(column)}`,
          );
        }

        // Build column type with length if specified
        let columnType = type;
        if (
          length &&
          ["VARCHAR", "CHAR", "DECIMAL", "NUMERIC"].includes(type.toUpperCase())
        ) {
          columnType = `${type}(${length})`;
        }

        // Build column definition
        let columnDef = `"${name}" ${columnType}`;

        // Add NOT NULL constraint
        if (!isNull) {
          columnDef += " NOT NULL";
        }

        // Add default value
        if (defaultValue) {
          if (
            type.toUpperCase() === "UUID" &&
            (defaultValue.includes("gen_random_uuid") ||
              defaultValue === "gen_random_uuid()")
          ) {
            columnDef += " DEFAULT gen_random_uuid()";
          } else if (
            type.toUpperCase() === "TIMESTAMP" &&
            (defaultValue.includes("now") ||
              defaultValue === "CURRENT_TIMESTAMP")
          ) {
            columnDef += " DEFAULT CURRENT_TIMESTAMP";
          } else if (
            ["VARCHAR", "CHAR", "TEXT"].includes(type.toUpperCase()) &&
            !defaultValue.startsWith("'") &&
            !defaultValue.toLowerCase().includes("null")
          ) {
            columnDef += ` DEFAULT '${defaultValue}'`;
          } else {
            columnDef += ` DEFAULT ${defaultValue}`;
          }
        }

        columnDefinitions.push(columnDef);

        // Track constraints for separate handling
        if (keyType === "PRIMARY" || isPrimaryKey) {
          primaryKeys.push(name);
        }

        if (isUnique && keyType !== "PRIMARY" && !isPrimaryKey) {
          uniqueColumns.push(name);
        }

        if (
          (keyType === "FOREIGN KEY" || isForeignKey) &&
          foreignTable &&
          foreignTableColumn
        ) {
          foreignKeys.push(
            `FOREIGN KEY ("${name}") REFERENCES ${currentSchema}."${foreignTable}"("${foreignTableColumn}")`,
          );
        }
      });

      // Add constraints
      if (primaryKeys.length > 0) {
        const pkColumns = primaryKeys.map((name) => `"${name}"`).join(", ");
        columnDefinitions.push(`PRIMARY KEY (${pkColumns})`);
      }

      // Add unique constraints
      uniqueColumns.forEach((name) => {
        columnDefinitions.push(`UNIQUE ("${name}")`);
      });

      // Add foreign key constraints
      columnDefinitions.push(...foreignKeys);

      const query = `CREATE TABLE ${currentSchema}."${formData.name}" (
        ${columnDefinitions.join(",\n    ")}
      )`;

      console.log("Generated SQL:", query);

      // Execute CREATE TABLE
      await this.executeQuery(query);

      // Add table-level constraints if any
      if (formData.constraints && formData.constraints.length > 0) {
        for (const constraint of formData.constraints) {
          if (constraint.name && constraint.definition) {
            let constraintSQL = "";
            if (constraint.type === "CHECK") {
              constraintSQL = `ALTER TABLE ${currentSchema}."${formData.name}" ADD CONSTRAINT "${constraint.name}" CHECK ${constraint.definition}`;
            } else if (constraint.type === "UNIQUE") {
              constraintSQL = `ALTER TABLE ${currentSchema}."${formData.name}" ADD CONSTRAINT "${constraint.name}" UNIQUE ${constraint.definition}`;
            } else if (constraint.type === "FOREIGN KEY") {
              constraintSQL = `ALTER TABLE ${currentSchema}."${formData.name}" ADD CONSTRAINT "${constraint.name}" FOREIGN KEY ${constraint.definition}`;
            } else if (constraint.type === "EXCLUDE") {
              constraintSQL = `ALTER TABLE ${currentSchema}."${formData.name}" ADD CONSTRAINT "${constraint.name}" EXCLUDE ${constraint.definition}`;
            }

            if (constraintSQL) {
              console.log("Adding constraint:", constraintSQL);
              await this.executeQuery(constraintSQL);
            }
          }
        }
      }

      // Add indexes if any
      if (formData.indexes && formData.indexes.length > 0) {
        for (const index of formData.indexes) {
          if (index.name && index.columns && index.columns.length > 0) {
            const uniqueKeyword = index.unique ? "UNIQUE " : "";
            const whereClause = index.where ? ` WHERE ${index.where}` : "";
            const columnsStr = index.columns
              .map((col: any) => `"${col}"`)
              .join(", ");

            const indexSQL = `CREATE ${uniqueKeyword}INDEX "${index.name}" ON ${currentSchema}."${formData.name}" USING ${index.type || "BTREE"} (${columnsStr})${whereClause}`;

            console.log("Adding index:", indexSQL);
            await this.executeQuery(indexSQL);
          }
        }
      }

      return { data: [], error: null };
    } catch (e) {
      console.error("Error creating table:", e);
      return {
        data: null,
        error: e instanceof Error ? e.message : "Failed to create the table",
      };
    }
  }

  generateWhereQuery(query: FilterType[]) {
    if (!query || !query.length) {
      return null;
    }

    const whereClauses = query
      .map(
        (
          { column, compare, separator, value, isCustomQuery, customQuery },
          index,
        ) => {
          if (separator === undefined) {
            return "";
          }

          // Handle custom SQL queries first
          if (isCustomQuery && customQuery && customQuery.trim()) {
            const actualSeparator = index === 0 ? "WHERE" : separator;
            return `${actualSeparator} ${customQuery.trim()}`;
          }

          // For regular filters, check required fields
          if (column === undefined || compare === undefined) {
            return "";
          }

          // Skip the first WHERE separator and use actual WHERE keyword
          const actualSeparator = index === 0 ? "WHERE" : separator;
          const quotedColumn = `"${column}"`;

          // Handle operations that don't need a value
          if (
            [
              "is null",
              "is not null",
              "is true",
              "is false",
              "is empty",
              "is not empty",
            ].includes(compare)
          ) {
            switch (compare) {
              case "is null":
                return `${actualSeparator} ${quotedColumn} IS NULL`;
              case "is not null":
                return `${actualSeparator} ${quotedColumn} IS NOT NULL`;
              case "is true":
                return `${actualSeparator} ${quotedColumn} = TRUE`;
              case "is false":
                return `${actualSeparator} ${quotedColumn} = FALSE`;
              case "is empty":
                return `${actualSeparator} (${quotedColumn} IS NULL OR ${quotedColumn} = '')`;
              case "is not empty":
                return `${actualSeparator} (${quotedColumn} IS NOT NULL AND ${quotedColumn} != '')`;
            }
          }

          // Handle date-specific operations
          if (
            [
              "is today",
              "is this week",
              "is this month",
              "is this year",
            ].includes(compare)
          ) {
            switch (compare) {
              case "is today":
                return `${actualSeparator} DATE(${quotedColumn}) = CURRENT_DATE`;
              case "is this week":
                return `${actualSeparator} DATE_TRUNC('week', ${quotedColumn}) = DATE_TRUNC('week', CURRENT_DATE)`;
              case "is this month":
                return `${actualSeparator} DATE_TRUNC('month', ${quotedColumn}) = DATE_TRUNC('month', CURRENT_DATE)`;
              case "is this year":
                return `${actualSeparator} DATE_TRUNC('year', ${quotedColumn}) = DATE_TRUNC('year', CURRENT_DATE)`;
            }
          }

          // Handle BETWEEN operations (need value2)
          if (["between", "not between"].includes(compare)) {
            const filterObj = query[index] as FilterType & { value2?: any };
            if (
              value === undefined ||
              value === null ||
              value === "" ||
              filterObj.value2 === undefined ||
              filterObj.value2 === null ||
              filterObj.value2 === ""
            ) {
              console.warn(
                `Filter values are incomplete for ${compare} operation on column ${column}`,
              );
              return "";
            }

            const formattedValue = this.formatValue(value);
            const formattedValue2 = this.formatValue(filterObj.value2);

            switch (compare) {
              case "between":
                return `${actualSeparator} ${quotedColumn} BETWEEN ${formattedValue} AND ${formattedValue2}`;
              case "not between":
                return `${actualSeparator} ${quotedColumn} NOT BETWEEN ${formattedValue} AND ${formattedValue2}`;
            }
          }

          // Handle IN operations (value should be comma-separated)
          if (["in", "not in"].includes(compare)) {
            if (value === undefined || value === null || value === "") {
              console.warn(
                `Filter value is empty for ${compare} operation on column ${column}`,
              );
              return "";
            }

            // Split comma-separated values and format each one
            const values = value
              .toString()
              .split(",")
              .map((v: string) => this.formatValue(v.trim()));
            const valuesList = values.join(", ");

            switch (compare) {
              case "in":
                return `${actualSeparator} ${quotedColumn} IN (${valuesList})`;
              case "not in":
                return `${actualSeparator} ${quotedColumn} NOT IN (${valuesList})`;
            }
          }

          // Operations that require a value
          if (value === undefined || value === null || value === "") {
            console.warn(
              `Filter value is empty for ${compare} operation on column ${column}`,
            );
            return "";
          }

          const formattedValue = this.formatValue(value);

          // Handle standard operations
          switch (compare) {
            case "equals":
              return `${actualSeparator} ${quotedColumn} = ${formattedValue}`;
            case "not equals":
              return `${actualSeparator} ${quotedColumn} != ${formattedValue}`;
            case "greater than":
              return `${actualSeparator} ${quotedColumn} > ${formattedValue}`;
            case "less than":
              return `${actualSeparator} ${quotedColumn} < ${formattedValue}`;
            case "greater than or equal":
              return `${actualSeparator} ${quotedColumn} >= ${formattedValue}`;
            case "less than or equal":
              return `${actualSeparator} ${quotedColumn} <= ${formattedValue}`;
            case "contains":
              return `${actualSeparator} ${quotedColumn} ILIKE '%' || ${formattedValue} || '%'`;
            case "not contains":
              return `${actualSeparator} ${quotedColumn} NOT ILIKE '%' || ${formattedValue} || '%'`;
            case "starts with":
              return `${actualSeparator} ${quotedColumn} ILIKE ${formattedValue} || '%'`;
            case "ends with":
              return `${actualSeparator} ${quotedColumn} ILIKE '%' || ${formattedValue}`;
            case "like":
              return `${actualSeparator} ${quotedColumn} LIKE ${formattedValue}`;
            case "not like":
              return `${actualSeparator} ${quotedColumn} NOT LIKE ${formattedValue}`;
            case "regex":
              return `${actualSeparator} ${quotedColumn} ~ ${formattedValue}`;
            case "has length":
              return `${actualSeparator} LENGTH(${quotedColumn}) = ${formattedValue}`;
            default:
              console.warn(`Unsupported filter operation: ${compare}`);
              return "";
          }
        },
      )
      .filter((clause) => clause !== "")
      .join(" ");

    return whereClauses;
  }
}
