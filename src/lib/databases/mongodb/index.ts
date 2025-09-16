import { ConnectionDetailsType } from "@/types/db.type";
import { DatabaseClient } from "@/lib/databases/database-client";
import { PaginationType } from "@/types/file.type";
import { FilterType, TableForm } from "@/types/table.type";
import { CollectionInfo, MongoClient, ObjectId } from "mongodb";
import { SortColumn } from "react-data-grid";
import { parseMongoDBSyntax } from "../../utils";

export class MongoDbClient extends DatabaseClient {
  private client: MongoClient | null = null;
  private db: any = null;

  // Destructor to ensure connections are closed when object is garbage collected
  public destroy() {
    console.log('🔌 MongoDB client destroy() called');
    this.disconnect();
  }

  // Finalizer for serverless environments
  public finalize() {
    console.log('🔌 MongoDB client finalize() called');
    this.disconnect();
  }

  // Enhanced disconnect with additional cleanup
  async disconnect() {
    if (this.client) {
      try {
        console.log('🔌 Closing MongoDB connection...');
        
        // Close the database connection
        if (this.db) {
          this.db = null;
        }
        
        // Close the client connection
        await this.client.close();
        console.log('✅ MongoDB connection closed successfully');
        
        // Force garbage collection hint
        this.client = null;
        
      } catch (error) {
        console.log('⚠️ Error closing MongoDB connection:', error);
      } finally {
        this.client = null;
        this.db = null;
        // Update connection state
        this.isConnected = false;
        this.isConnecting = false;
      }
    }
  }

  // Helper function to convert MongoDB BSON types to displayable strings
  private convertObjectIdToString(value: any): any {
    if (value && typeof value === "object" && value._bsontype) {
      switch (value._bsontype) {
        case "ObjectID":
          return value.toString();
        case "Binary":
          return `Binary(${value.sub_type}, ${value.buffer.length} bytes)`;
        case "Code":
          return `Code(${value.code})`;
        case "DBRef":
          return `DBRef(${value.db}, ${value.collection}, ${value.oid})`;
        case "Decimal128":
          return value.toString();
        case "Double":
          return value.toString();
        case "Int32":
          return value.toString();
        case "Long":
          return value.toString();
        case "MaxKey":
          return "MaxKey";
        case "MinKey":
          return "MinKey";
        case "ObjectId":
          return value.toString();
        case "Symbol":
          return value.toString();
        case "Timestamp":
          return new Date(value.high * 1000 + value.low).toISOString();
        case "UUID":
          return value.toString();
        default:
          return value.toString();
      }
    }
    return value;
  }

  // Helper function to convert MongoDB document for display
  private convertDocumentForDisplay(doc: any): any {
    if (Array.isArray(doc)) {
      return doc.map((item) => this.convertDocumentForDisplay(item));
    } else if (doc && typeof doc === "object") {
      // Handle MongoDB BSON types
      if (doc._bsontype) {
        return this.convertObjectIdToString(doc);
      }

      // Handle Date objects
      if (doc instanceof Date) {
        return doc.toISOString();
      }

      // Handle objects with toJSON method (Next.js compatibility)
      if (typeof doc.toJSON === "function") {
        try {
          const jsonDoc = doc.toJSON();
          return this.convertDocumentForDisplay(jsonDoc);
        } catch (error) {
          // If toJSON fails, create a plain object representation
          const plainDoc: any = {};
          for (const [key, value] of Object.entries(doc)) {
            if (key !== "toJSON" && typeof value !== "function") {
              plainDoc[key] = this.convertDocumentForDisplay(value);
            }
          }
          return plainDoc;
        }
      }

      // Handle regular objects
      const converted: any = {};
      for (const [key, value] of Object.entries(doc)) {
        // Skip function properties to avoid Next.js warnings
        if (typeof value !== "function") {
          converted[key] = this.convertDocumentForDisplay(value);
        }
      }
      return converted;
    } else {
      return this.convertObjectIdToString(doc);
    }
  }

  // Helper function to format complex objects for better display
  private formatComplexValue(
    value: any,
    maxDepth: number = 3,
    currentDepth: number = 0,
  ): any {
    if (currentDepth >= maxDepth) {
      return "[Complex Object]";
    }

    if (value === null) {
      return "null";
    }

    if (value === undefined) {
      return "undefined";
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return "[]";
      }
      if (value.length <= 5) {
        return value.map((item) =>
          this.formatComplexValue(item, maxDepth, currentDepth + 1),
        );
      } else {
        return `[${value.length} items]`;
      }
    }

    if (value && typeof value === "object") {
      // Handle MongoDB BSON types
      if (value._bsontype) {
        return this.convertObjectIdToString(value);
      }

      // Check if object has toJSON method (Next.js warning)
      if (typeof value.toJSON === "function") {
        try {
          const jsonValue = value.toJSON();
          return this.formatComplexValue(jsonValue, maxDepth, currentDepth + 1);
        } catch (error) {
          // If toJSON fails, fall back to string representation
          return `{${Object.keys(value).length} fields}`;
        }
      }

      const keys = Object.keys(value);
      if (keys.length === 0) {
        return "{}";
      }

      if (keys.length <= 5) {
        const formatted: any = {};
        for (const key of keys) {
          formatted[key] = this.formatComplexValue(
            value[key],
            maxDepth,
            currentDepth + 1,
          );
        }
        return formatted;
      } else {
        return `{${keys.length} fields}`;
      }
    }

    return String(value);
  }

  // Helper function to ensure objects are serializable for Next.js
  private ensureSerializable(obj: any): any {
    try {
      // Try to serialize and deserialize to ensure it's a plain object
      const serialized = JSON.parse(JSON.stringify(obj));
      return serialized;
    } catch (error) {
      // If serialization fails, convert to a safe representation
      if (Array.isArray(obj)) {
        return obj.map((item) => this.ensureSerializable(item));
      } else if (obj && typeof obj === "object") {
        const safeObj: any = {};
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value !== "function" && key !== "toJSON") {
            try {
              safeObj[key] = this.ensureSerializable(value);
            } catch (err) {
              safeObj[key] = `[Unserializable: ${typeof value}]`;
            }
          }
        }
        return safeObj;
      } else {
        return obj;
      }
    }
  }

  // Helper function to create a safe object representation
  private createSafeObjectRepresentation(
    obj: any,
    maxDepth: number = 2,
    currentDepth: number = 0,
  ): any {
    if (currentDepth >= maxDepth) {
      return "[Deep Object]";
    }

    if (obj === null) return "null";
    if (obj === undefined) return "undefined";

    if (
      typeof obj === "string" ||
      typeof obj === "number" ||
      typeof obj === "boolean"
    ) {
      return obj;
    }

    if (obj instanceof Date) {
      return obj.toISOString();
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) return "[]";
      if (obj.length <= 3) {
        return obj.map((item) =>
          this.createSafeObjectRepresentation(item, maxDepth, currentDepth + 1),
        );
      } else {
        return `[${obj.length} items]`;
      }
    }

    if (obj && typeof obj === "object") {
      // Handle MongoDB BSON types
      if (obj._bsontype) {
        return this.convertObjectIdToString(obj);
      }

      const keys = Object.keys(obj);
      if (keys.length === 0) return "{}";

      if (keys.length <= 5) {
        const safeObj: any = {};
        for (const key of keys) {
          if (typeof obj[key] !== "function" && key !== "toJSON") {
            safeObj[key] = this.createSafeObjectRepresentation(
              obj[key],
              maxDepth,
              currentDepth + 1,
            );
          }
        }
        return safeObj;
      } else {
        return `{${keys.length} fields: ${keys.slice(0, 3).join(", ")}...}`;
      }
    }

    return String(obj);
  }

  async connectDb({
    connectionDetails,
  }: {
    connectionDetails: ConnectionDetailsType;
  }) {
    try {
      // Close existing connection if it exists
      if (this.client) {
        console.log('🔌 Closing existing MongoDB connection before creating new one...');
        await this.disconnect();
      }

      const uri = connectionDetails.connection_string;

      this.client = new MongoClient(uri,{
        maxIdleTimeMS: 15 * 60 * 1000, // 15 minutes
      });
      await this.client.connect();

      // Try to get database from connection details or URI
      let databaseName = connectionDetails.database;

      if (!databaseName) {
        // Extract database name from URI if not provided in connection details
        try {
          const url = new URL(uri);
          databaseName = url.pathname.replace("/", "") || undefined;
        } catch (urlError) {
          // Silently continue if URI parsing fails
        }
      }

      if (databaseName) {
        this.db = this.client.db(databaseName);
      } else {
        this.db = this.client.db();
      }

      // Test the connection by trying to ping
      try {
        await this.db.admin().ping();
      } catch (pingError) {
        // Connection test failed, but continue anyway
      }

      // Update connection state
      this.isConnected = true;
      this.isConnecting = false;

      return { success: true };
    } catch (error) {
      // Clean up on error
      if (this.client) {
        try {
          await this.client.close();
        } catch (closeError) {
          console.error('Error closing client after connection failure:', closeError);
        }
        this.client = null;
        this.db = null;
      }
      
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to connect to MongoDB",
      };
    }
  }



  isConnectedToDb() {
    return !!this.db && !!this.client && this.isConnectionValid();
  }

  async executeQuery(query: string) {
    if (!this.db) {
      return {
        data: null,
        message: null,
        isTableEffected: false,
        effectedRows: 0,
        error: "No connection to the database",
      };
    }

    try {
      // Clean and normalize the query
      const cleanQuery = query.trim();

      if (cleanQuery.startsWith("db.")) {
        const command = cleanQuery.replace("db.", ""); // Remove 'db.'
        const [collectionName, operation] = command.split(".", 2);

        if (!collectionName || !operation) {
          throw new Error(
            "Invalid command format. Expected: db.collection.operation()",
          );
        }

        const collection: any = this.db.collection(collectionName);
        const operationMatch = operation.match(/(\w+)\((.*)\)/);

        if (!operationMatch) {
          throw new Error(
            "Unsupported command format. Expected: operation(arguments)",
          );
        }

        const operationName = operationMatch[1];
        const operationArgs = operationMatch[2];

        let parsedArgs: any[] = [];
        if (operationArgs.trim()) {
          try {
            // Handle different argument formats
            if (
              operationArgs.trim().startsWith("[") &&
              operationArgs.trim().endsWith("]")
            ) {
              // Array format - try flexible parsing first, then strict JSON
              try {
                parsedArgs = parseMongoDBSyntax(operationArgs);
              } catch {
                parsedArgs = JSON.parse(operationArgs);
              }
            } else if (
              operationArgs.trim().startsWith("{") &&
              operationArgs.trim().endsWith("}")
            ) {
              // Single object format - try flexible parsing first, then strict JSON
              try {
                parsedArgs = [parseMongoDBSyntax(operationArgs)];
              } catch {
                parsedArgs = [JSON.parse(operationArgs)];
              }
            } else {
              // Try to parse as comma-separated arguments
              parsedArgs = JSON.parse(`[${operationArgs}]`);
            }
          } catch (parseError: any) {
            throw new Error(
              `Invalid argument format: ${operationArgs}. Error: ${parseError.message}`,
            );
          }
        }

        // Validate operation exists
        if (typeof collection[operationName] !== "function") {
          throw new Error(`Unsupported operation: ${operationName}`);
        }

        // Execute the operation
        let result: any;
        const method = collection[operationName];

        try {
          if (operationName === "aggregate") {
            // Handle aggregation pipeline
            result = await method.apply(collection, parsedArgs).toArray();
          } else if (operationName === "find" || operationName === "findOne") {
            // Handle find operations
            result = await method.apply(collection, parsedArgs);
            if (operationName === "find") {
              result = await result.toArray();
            }
          } else if (
            operationName === "countDocuments" ||
            operationName === "estimatedDocumentCount"
          ) {
            // Handle count operations
            result = await method.apply(collection, parsedArgs);
          } else if (operationName === "distinct") {
            // Handle distinct operation
            result = await method.apply(collection, parsedArgs);
          } else if (
            operationName === "insertOne" ||
            operationName === "insertMany"
          ) {
            // Handle insert operations
            result = await method.apply(collection, parsedArgs);
            if (operationName === "insertOne") {
              result = {
                insertedId: result.insertedId,
                acknowledged: result.acknowledged,
              };
            } else {
              result = {
                insertedIds: result.insertedIds,
                acknowledged: result.acknowledged,
              };
            }
          } else if (
            operationName === "updateOne" ||
            operationName === "updateMany"
          ) {
            // Handle update operations
            result = await method.apply(collection, parsedArgs);
            result = {
              matchedCount: result.matchedCount,
              modifiedCount: result.modifiedCount,
              acknowledged: result.acknowledged,
            };
          } else if (
            operationName === "deleteOne" ||
            operationName === "deleteMany"
          ) {
            // Handle delete operations
            result = await method.apply(collection, parsedArgs);
            result = {
              deletedCount: result.deletedCount,
              acknowledged: result.acknowledged,
            };
          } else if (operationName === "replaceOne") {
            // Handle replace operation
            result = await method.apply(collection, parsedArgs);
            result = {
              matchedCount: result.matchedCount,
              modifiedCount: result.modifiedCount,
              acknowledged: result.acknowledged,
            };
          } else if (
            operationName === "createIndex" ||
            operationName === "dropIndex"
          ) {
            // Handle index operations
            result = await method.apply(collection, parsedArgs);
          } else if (
            operationName === "getIndexes" ||
            operationName === "listIndexes"
          ) {
            // Handle index listing operations
            result = await method.apply(collection, parsedArgs);
            if (operationName === "getIndexes") {
              result = await result.toArray();
            } else {
              result = await result.toArray();
            }
          } else {
            // Generic execution for other operations
            result = await method.apply(collection, parsedArgs);
            // Check if result has toArray method (cursor)
            if (result && typeof result.toArray === "function") {
              result = await result.toArray();
            }
            // Check if result has next method (cursor)
            if (result && typeof result.next === "function") {
              const cursorResult = [];
              while (await result.hasNext()) {
                cursorResult.push(await result.next());
              }
              result = cursorResult;
            }
          }

          // Format the response to match PostgreSQL format
          if (Array.isArray(result)) {
            // Array result (documents, aggregation results, etc.)
            if (result.length > 0) {
              // Extract column names from the first document
              const columns = Object.keys(result[0]).map((key) => {
                const value = result[0][key];
                let dataType: string = typeof value;

                // Handle MongoDB-specific types
                if (value === null) {
                  dataType = "null";
                } else if (value instanceof Date) {
                  dataType = "date";
                } else if (Array.isArray(value)) {
                  dataType = "array";
                } else if (typeof value === "object" && value._bsontype) {
                  // MongoDB BSON types
                  dataType = value._bsontype.toLowerCase();
                }

                return {
                  column_name: key,
                  data_type: dataType,
                };
              });

              // Convert MongoDB documents for better display with smart formatting
              const convertedRows = result.map((doc, index) => {
                const converted = this.convertDocumentForDisplay(doc);

                // Apply smart formatting for complex values
                const formatted: any = {};
                for (const [key, value] of Object.entries(converted)) {
                  formatted[key] = this.formatComplexValue(value);
                }

                // Ensure the formatted object is serializable for Next.js
                const serializableRow = this.ensureSerializable(formatted);

                // Debug logging to identify [object Object] issues
                for (const [key, value] of Object.entries(serializableRow)) {
                  if (String(value) === "[object Object]") {
                    // Use safe object representation as fallback
                    serializableRow[key] =
                      this.createSafeObjectRepresentation(value);
                  }
                }

                return serializableRow;
              });

              return {
                data: { columns, rows: convertedRows },
                message: `Successfully executed ${operationName}. Found ${result.length} document(s).`,
                isTableEffected: false,
                effectedRows: result.length,
                error: null,
              };
            } else {
              return {
                data: { columns: [], rows: [] },
                message: `Successfully executed ${operationName}. No documents found.`,
                isTableEffected: false,
                effectedRows: 0,
                error: null,
              };
            }
          } else if (result && typeof result === "object") {
            // Object result (insert, update, delete operations)
            const columns = Object.keys(result).map((key) => {
              const value = result[key];
              let dataType: string = typeof value;

              // Handle MongoDB-specific types
              if (value === null) {
                dataType = "null";
              } else if (value instanceof Date) {
                dataType = "date";
              } else if (Array.isArray(value)) {
                dataType = "array";
              } else if (typeof value === "object" && value._bsontype) {
                // MongoDB BSON types
                dataType = value._bsontype.toLowerCase();
              }

              return {
                column_name: key,
                data_type: dataType,
              };
            });

            // Check if this is a write operation
            const isTableEffected = [
              "insertOne",
              "insertMany",
              "updateOne",
              "updateMany",
              "deleteOne",
              "deleteMany",
              "replaceOne",
            ].includes(operationName);
            const effectedRows = isTableEffected
              ? result.matchedCount ||
                result.modifiedCount ||
                result.deletedCount ||
                result.insertedCount ||
                0
              : 0;

            // Convert MongoDB result for better display with smart formatting
            const convertedResult = this.convertDocumentForDisplay(result);
            const formattedResult: any = {};
            for (const [key, value] of Object.entries(convertedResult)) {
              formattedResult[key] = this.formatComplexValue(value);
            }

            // Ensure the formatted result is serializable for Next.js
            const serializableResult = this.ensureSerializable(formattedResult);

            // Debug logging to identify [object Object] issues
            for (const [key, value] of Object.entries(serializableResult)) {
              if (String(value) === "[object Object]") {
                // Use safe object representation as fallback
                serializableResult[key] =
                  this.createSafeObjectRepresentation(value);
              }
            }

            return {
              data: { columns, rows: [serializableResult] },
              message: `Successfully executed ${operationName}.`,
              isTableEffected,
              effectedRows,
              error: null,
            };
          } else {
            // Primitive result (count, etc.)
            return {
              data: {
                columns: [{ column_name: "result", data_type: typeof result }],
                rows: [{ result }],
              },
              message: `Successfully executed ${operationName}. Result: ${result}`,
              isTableEffected: false,
              effectedRows: 1,
              error: null,
            };
          }
        } catch (executionError: any) {
          throw new Error(
            `Execution error in ${operationName}: ${executionError.message}`,
          );
        }
      } else {
        throw new Error("Invalid MongoDB query. Query must start with 'db.'");
      }
    } catch (error: any) {
      return {
        data: null,
        message: null,
        isTableEffected: false,
        effectedRows: 0,
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
      const client = new MongoClient(uri);

      await client.connect();
      await client.close();
      return { success: true, error: null };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getTablesWithFieldsFromDb(
    currentSchema: string = "",
    isUpdateSchema: boolean = false,
  ) {
    if (!this.db) {
      return { tables: [], error: "No connection to the database" };
    }

    if (!this.client) {
      return { tables: [], error: "No client connection to the database" };
    }

    try {
      // First, test if we can access the database
      try {
        await this.db.admin().ping();
      } catch (pingError) {
        return { tables: [], error: "Database connection is not accessible" };
      }

      const result: CollectionInfo[] = await this.db
        .listCollections()
        .toArray();

      if (!Array.isArray(result)) {
        return { tables: [], error: "Invalid response from database" };
      }

      const collections = result.map((collection) => ({
        table_name: collection.name,
        fields: [],
      }));

      return { tables: collections, error: null };
    } catch (error: any) {
      return { tables: [], error: error.message };
    }
  }

  async getDatabases() {
    if (!this.client) {
      return { databases: [], error: "No connection to the database" };
    }
    try {
      // Query to retrieve all databases
      const result = await this.client.db().admin().listDatabases();

      const databases = result.databases
        .filter((db: any) => db.name !== "admin" && db.name !== "local")
        .map((db: any) => ({ database_name: db.name }));

      return { databases: databases || [], error: null };
    } catch (error: any) {
      return { databases: [], error: error.message };
    }
  }

  async getSchemas() {
    // MongoDB doesn't have schemas in the same way as SQL databases
    return { schemas: [], error: null };
  }

  async getTableRelations(tableName: string) {
    // MongoDB doesn't have foreign key relationships like SQL databases
    return { data: [], error: null };
  }

  async getTableColumns(table_name: string) {
    if (!this.db)
      return { columns: null, error: "No connection to the database" };

    try {
      // Use aggregation to get unique fields and their types
      const result = await this.db
        .collection(table_name)
        .aggregate([
          { $limit: 100 }, // Limit documents to sample schema from a subset of records
          {
            $project: {
              fields: {
                $objectToArray: "$$ROOT",
              },
            },
          },
          { $unwind: "$fields" },
          {
            $group: {
              _id: "$fields.k",
              data_types: { $addToSet: { $type: "$fields.v" } },
            },
          },
          { $sort: { _id: 1 } }, // Ensure consistent ordering of field names
        ])
        .toArray();

      if (!result.length)
        return { columns: null, error: "Table not found or empty" };

      const columns = result.map((field: any) => ({
        column_name: field._id,
        data_type: field.data_types?.[0], // Array of possible types due to MongoDB's flexible schema
      }));

      return { columns, error: null };
    } catch (error: any) {
      return { columns: null, error: error.message };
    }
  }

  async getTablesData(
    tableName: string,
    options?: {
      filters?: FilterType[];
      orderBy?: SortColumn[];
      pagination?: PaginationType;
    },
  ) {
    if (!this.db)
      return {
        data: null,
        error: "No connection to the database",
        totalRecords: 0,
      };
    try {
      const { filters, orderBy, pagination } = options || {};
      const { page, limit } = pagination || { page: 1, limit: 10 };
      const skip = (page - 1) * limit;

      let filterQuery = {};
      let customSortBy = {};

      if (filters && filters.length > 0) {
        // Extract sortBy from the first filter if it exists
        if (filters[0]?.sortBy && filters[0].sortBy.trim()) {
          try {
            customSortBy = parseMongoDBSyntax(filters[0].sortBy.trim());
          } catch (error) {
            // Invalid sortBy format, continue with empty sort
          }
        }

        // Check if we have a custom query
        const customQueryFilter = filters.find(
          (filter) =>
            filter.isCustomQuery &&
            filter.customQuery &&
            filter.customQuery.trim(),
        );

        if (
          customQueryFilter &&
          customQueryFilter.customQuery &&
          customQueryFilter.customQuery.trim()
        ) {
          try {
            // Use custom query directly
            filterQuery = parseMongoDBSyntax(
              customQueryFilter.customQuery.trim(),
            );
          } catch (error) {
            filterQuery = {};
          }
        } else {
          // Process regular filters
          const mongoFilters = filters
            .map((filter) => {
              const { column, compare, value, value2 } = filter;

              // Skip filters that don't have the required fields for regular filtering
              if (!column || !compare || value === undefined || value === "") {
                return null;
              }

              const field = column === "_id" ? "_id" : column;

              // Handle ObjectId conversion for _id field
              const processValue = (val: any) => {
                if (field === "_id" && typeof val === "string") {
                  try {
                    return ObjectId.createFromHexString(val);
                  } catch {
                    return val; // Return original value if ObjectId conversion fails
                  }
                }
                return val;
              };

              switch (compare) {
                // Null checks
                case "is null":
                  return { [field]: null };
                case "is not null":
                  return { [field]: { $ne: null } };

                // Boolean checks
                case "is true":
                  return { [field]: true };
                case "is false":
                  return { [field]: false };

                // Empty checks
                case "is empty":
                  return { $or: [{ [field]: null }, { [field]: "" }] };
                case "is not empty":
                  return {
                    $and: [
                      { [field]: { $ne: null } },
                      { [field]: { $ne: "" } },
                    ],
                  };

                // String operations
                case "equals":
                  return { [field]: processValue(value) };
                case "not equals":
                  return { [field]: { $ne: processValue(value) } };
                case "contains":
                  return { [field]: { $regex: value, $options: "i" } };
                case "not contains":
                  return {
                    [field]: { $not: { $regex: value, $options: "i" } },
                  };
                case "starts with":
                  return { [field]: { $regex: `^${value}`, $options: "i" } };
                case "ends with":
                  return { [field]: { $regex: `${value}$`, $options: "i" } };
                case "regex":
                  return { [field]: { $regex: value } };

                // Numeric/Date comparisons
                case "greater than":
                  return { [field]: { $gt: processValue(value) } };
                case "less than":
                  return { [field]: { $lt: processValue(value) } };
                case "greater than or equal":
                  return { [field]: { $gte: processValue(value) } };
                case "less than or equal":
                  return { [field]: { $lte: processValue(value) } };

                // Range operations
                case "between":
                  return {
                    [field]: {
                      $gte: processValue(value),
                      $lte: processValue(value2),
                    },
                  };
                case "not between":
                  return {
                    $or: [
                      { [field]: { $lt: processValue(value) } },
                      { [field]: { $gt: processValue(value2) } },
                    ],
                  };

                // Array operations
                case "in":
                  const inValues = value
                    .toString()
                    .split(",")
                    .map((v: string) => processValue(v.trim()));
                  return { [field]: { $in: inValues } };
                case "not in":
                  const notInValues = value
                    .toString()
                    .split(",")
                    .map((v: string) => processValue(v.trim()));
                  return { [field]: { $nin: notInValues } };

                // Date-specific operations
                case "is today":
                  const today = new Date();
                  const startOfDay = new Date(
                    today.getFullYear(),
                    today.getMonth(),
                    today.getDate(),
                  );
                  const endOfDay = new Date(
                    today.getFullYear(),
                    today.getMonth(),
                    today.getDate() + 1,
                  );
                  return { [field]: { $gte: startOfDay, $lt: endOfDay } };

                case "is this week":
                  const now = new Date();
                  const startOfWeek = new Date(
                    now.setDate(now.getDate() - now.getDay()),
                  );
                  const endOfWeek = new Date(
                    now.setDate(now.getDate() - now.getDay() + 7),
                  );
                  return { [field]: { $gte: startOfWeek, $lt: endOfWeek } };

                case "is this month":
                  const thisMonth = new Date();
                  const startOfMonth = new Date(
                    thisMonth.getFullYear(),
                    thisMonth.getMonth(),
                    1,
                  );
                  const endOfMonth = new Date(
                    thisMonth.getFullYear(),
                    thisMonth.getMonth() + 1,
                    1,
                  );
                  return { [field]: { $gte: startOfMonth, $lt: endOfMonth } };

                case "is this year":
                  const thisYear = new Date();
                  const startOfYear = new Date(thisYear.getFullYear(), 0, 1);
                  const endOfYear = new Date(thisYear.getFullYear() + 1, 0, 1);
                  return { [field]: { $gte: startOfYear, $lt: endOfYear } };

                // Array-specific operations
                case "has length":
                  return { [field]: { $size: parseInt(value) } };

                default:
                  return null;
              }
            })
            .filter(
              (filter): filter is any =>
                filter !== null && Object.keys(filter).length > 0,
            );

          if (mongoFilters.length > 0) {
            filterQuery =
              mongoFilters.length === 1
                ? mongoFilters[0]
                : { $and: mongoFilters };
          } else {
            // If no valid filters but we have sortBy, use empty filter to get all documents
            filterQuery = {};
          }
        }
      }

      const result = await this.db
        .collection(tableName)
        .find(filterQuery)
        .skip(skip)
        .limit(limit)
        .sort(
          Object.keys(customSortBy).length > 0
            ? customSortBy
            : orderBy && orderBy?.length > 0
              ? {
                  [orderBy[0].columnKey]:
                    orderBy[0].direction === "ASC" ? 1 : -1,
                }
              : {},
        )
        .toArray();

      const totalRecords = await this.db.collection(tableName).countDocuments();
      return { data: result, error: null, totalRecords };
    } catch (error: any) {
      return { data: null, error: error.message, totalRecords: 0 };
    }
  }

  async dropTable(tableName: string) {
    if (!this.db) {
      return { data: null, error: "No connection to the database" };
    }

    try {
      // Query to drop the table
      await this.db.collection(tableName).drop();

      return { data: null, error: null };
    } catch (error: any) {
      return { data: null, error: error.message };
    }
  }

  /**
   * Updates MongoDB documents with support for field updates, additions, and removals
   * @param tableName - Name of the collection to update
   * @param data - Array of objects containing oldValue and newValue for comparison
   * @returns Object with updated data, effected rows count, and any errors
   */
  async updateTable(
    tableName: string,
    data: Array<{
      oldValue: Record<string, any>;
      newValue: Record<string, any>;
    }>,
  ) {
    if (!this.db) {
      return {
        data: null,
        effectedRows: 0,
        updatedError: "No connection to the database",
        fetchError: null,
      };
    }

    try {
      // Get collection schema to validate data types
      const { columns: schemaColumns, error: schemaError } = await this.getTableColumns(tableName);
      if (schemaError) {
        return {
          data: null,
          effectedRows: 0,
          updatedError: `Failed to get collection schema: ${schemaError}`,
          fetchError: null,
        };
      }

      // Create a map of field names to their expected data types
      const fieldTypeMap = new Map<string, string>();
      if (schemaColumns) {
        schemaColumns.forEach((col: any) => {
          fieldTypeMap.set(col.column_name, col.data_type);
        });
      }

      let totalUpdated = 0;
      for (const { oldValue, newValue } of data) {
        // For MongoDB, we need to use the _id field for reliable updates
        if (!oldValue._id) {
          continue;
        }

        // Convert _id to ObjectId for the filter
        let filterId;
        try {
          filterId =
            typeof oldValue._id === "string"
              ? ObjectId.createFromHexString(oldValue._id)
              : oldValue._id;
        } catch (error) {
          continue;
        }

        // Create the update document with only changed fields
        const updateDoc: any = {};
        const unsetDoc: any = {};

        // Check for fields to update or add
        Object.keys(newValue).forEach((key) => {
          if (key !== "_id" && newValue[key] !== oldValue[key]) {
            // Validate and convert data type based on collection schema
            const expectedType = fieldTypeMap.get(key);
            if (expectedType) {
              try {
                updateDoc[key] = this.convertToMongoDBType(newValue[key], expectedType, key);
              } catch (typeError: any) {
                throw new Error(`Field '${key}': ${typeError.message}`);
              }
            } else {
              // If field type is not in schema, use the value as-is
              updateDoc[key] = newValue[key];
            }
          }
        });

        // Check for fields that were removed (exist in oldValue but not in newValue)
        // This handles cases where users delete fields from the JSON editor
        Object.keys(oldValue).forEach((key) => {
          if (key !== "_id" && !(key in newValue)) {
            unsetDoc[key] = ""; // $unset requires a value, but it's ignored
          }
        });

        // If no fields actually changed or removed, skip this update
        if (
          Object.keys(updateDoc).length === 0 &&
          Object.keys(unsetDoc).length === 0
        ) {
          continue;
        }

        // Build the update operation combining $set and $unset operations
        // $set: Updates existing fields or adds new fields
        // $unset: Removes fields that exist in oldValue but not in newValue
        const updateOperation: any = {};
        if (Object.keys(updateDoc).length > 0) {
          updateOperation.$set = updateDoc;
        }
        if (Object.keys(unsetDoc).length > 0) {
          updateOperation.$unset = unsetDoc;
        }

        // Use updateOne with _id filter for reliable updates
        const result = await this.db
          .collection(tableName)
          .updateOne({ _id: filterId }, updateOperation);

        if (result.matchedCount > 0) {
          totalUpdated += result.modifiedCount;
        }
      }

      // Fetch updated data
      const { data: updatedData, error: fetchError } =
        await this.getTablesData(tableName);

      return {
        data: updatedData,
        effectedRows: totalUpdated,
        updatedError: null,
        fetchError,
      };
    } catch (error: any) {
      return {
        data: null,
        effectedRows: 0,
        updatedError: error.message,
        fetchError: null,
      };
    }
  }

  /**
   * Converts a value to the appropriate MongoDB type based on the expected field type
   * @param value - The value to convert
   * @param expectedType - The expected MongoDB data type
   * @param fieldName - The name of the field (for error messages)
   * @returns The converted value in the appropriate MongoDB type
   * @throws Error if the value cannot be converted to the expected type
   */
  private convertToMongoDBType(value: any, expectedType: string, fieldName: string): any {
    const type = expectedType.toLowerCase();
    
    try {
      switch (type) {
        case 'objectid':
        case 'object id':
          if (typeof value === 'string') {
            if (/^[0-9a-fA-F]{24}$/.test(value)) {
              return ObjectId.createFromHexString(value);
            } else {
              throw new Error(`Invalid ObjectId format: '${value}'. ObjectId must be a 24-character hex string.`);
            }
          } else if (value instanceof ObjectId) {
            return value;
          } else {
            throw new Error(`Cannot convert ${typeof value} '${value}' to ObjectId. Expected string or ObjectId.`);
          }

        case 'date':
        case 'datetime':
        case 'timestamp':
          if (typeof value === 'string') {
            const date = new Date(value);
            if (isNaN(date.getTime())) {
              throw new Error(`Invalid date format: '${value}'. Expected ISO date string (e.g., '2024-01-01T00:00:00.000Z').`);
            }
            return date;
          } else if (value instanceof Date) {
            return value;
          } else {
            throw new Error(`Cannot convert ${typeof value} '${value}' to Date. Expected string or Date.`);
          }

        case 'number':
        case 'int':
        case 'integer':
        case 'long':
        case 'double':
        case 'decimal':
          if (typeof value === 'number') {
            return value;
          } else if (typeof value === 'string') {
            const num = Number(value);
            if (isNaN(num)) {
              throw new Error(`Cannot convert string '${value}' to number.`);
            }
            return num;
          } else {
            throw new Error(`Cannot convert ${typeof value} '${value}' to number. Expected number or numeric string.`);
          }

        case 'boolean':
        case 'bool':
          if (typeof value === 'boolean') {
            return value;
          } else if (typeof value === 'string') {
            const lowerValue = value.toLowerCase();
            if (lowerValue === 'true') return true;
            if (lowerValue === 'false') return false;
            throw new Error(`Cannot convert string '${value}' to boolean. Expected 'true' or 'false'.`);
          } else {
            throw new Error(`Cannot convert ${typeof value} '${value}' to boolean. Expected boolean or string 'true'/'false'.`);
          }

        case 'string':
        case 'varchar':
        case 'text':
        case 'char':
          return String(value);

        case 'array':
          if (Array.isArray(value)) {
            return value;
          } else {
            throw new Error(`Cannot convert ${typeof value} '${value}' to array. Expected array.`);
          }

        case 'object':
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            return value;
          } else {
            throw new Error(`Cannot convert ${typeof value} '${value}' to object. Expected object.`);
          }

        default:
          // For unknown types, return the value as-is
          return value;
      }
    } catch (error: any) {
      // Re-throw with more context
      throw new Error(`Type conversion failed for field '${fieldName}': ${error.message}`);
    }
  }

  async deleteTableData(tableName: string, data: any[]) {
    // Check if the database connection exists
    if (!this.db) {
      return { data: null, deleteError: "No connection to the database" };
    }

    // Validate the input data
    if (!Array.isArray(data) || data.length === 0) {
      return { data: null, deleteError: "No records provided for deletion" };
    }

    try {
      // Build the deletion filter
      const ids = data.map((item) => ObjectId.createFromHexString(item._id)); // Assuming `_id` is used for deletion
      const result = await this.db
        .collection(tableName)
        .deleteMany({ _id: { $in: ids } });

      const { data: updatedData, error: fetchError } =
        await this.getTablesData(tableName);

      return {
        data: updatedData,
        effectedRows: result.deletedCount, // Number of records deleted
        deleteError: null,
        fetchError,
      };
    } catch (error: any) {
      return {
        data: null,
        deleteError:
          error.message || "An error occurred while deleting records",
      };
    }
  }

  async insertRecord(data: { tableName: string; values: any }) {
    const { tableName, values } = data;

    // Check if the database connection exists
    if (!this.db) {
      return {
        data: null,
        effectedRows: 0,
        error: "No connection to the database",
      };
    }

    // Validate the input values
    if (!Array.isArray(values) || values.length === 0) {
      return { data: null, effectedRows: 0, error: "No records to insert" };
    }

    try {
      // Insert multiple records into the specified collection
      const result = await this.db.collection(tableName).insertMany(values);

      const newData = await this.db
        .collection(tableName)
        .find({
          _id: { $in: Object.values(result.insertedIds).map((key) => key) },
        })
        .toArray();

      return {
        data: newData,
        effectedRows: result.insertedCount, // Number of records inserted
        error: null,
      };
    } catch (error: any) {
      return {
        data: null,
        effectRows: 0,
        error: error.message || "An error occurred while inserting records",
      };
    }
  }

  async createTable(data: TableForm) {
    if (!this.db) {
      return { data: null, error: "No connection to the database" };
    }

    try {
      // In MongoDB, we don't need to explicitly create collections
      // They are created automatically when first document is inserted
      // However, we can create an empty collection to ensure it exists
      await this.db.createCollection(data.name);

      // If there are any indexes defined in the columns, create them
      if (data.columns && data.columns.length > 0) {
        const indexes = data.columns
          .filter((col) => col.keyType === "PRIMARY")
          .map((col) => ({ key: { [col.name]: 1 }, unique: true }));

        if (indexes.length > 0) {
          await this.db.collection(data.name).createIndexes(indexes);
        }
      }

      return { data: [], error: null };
    } catch (error: any) {
      return { data: null, error: error.message };
    }
  }
}
