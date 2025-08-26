import { ConnectionDetailsType, DatabaseClient } from "@/types/db.type";
import { PaginationType } from "@/types/file.type";
import { FilterType, TableForm } from "@/types/table.type";
import { CollectionInfo, MongoClient, ObjectId } from "mongodb";
import { SortColumn } from "react-data-grid";

export class MongoDbClient implements DatabaseClient {
  private client: MongoClient | null = null;
  private db: any = null;

  // Helper function to parse flexible object syntax
  private parseFlexibleObject(input: string): any {
    if (!input || typeof input !== 'string') return {};
    
    try {
      // First try standard JSON parsing
      return JSON.parse(input);
    } catch (error) {
      try {
        // If JSON parsing fails, try to convert to valid JSON
        // Replace unquoted keys with quoted keys
        let processedInput = input.trim();
        
        // Handle edge cases
        if (!processedInput.startsWith('{') || !processedInput.endsWith('}')) {
          throw new Error('Invalid object format');
        }
        
        // Remove outer braces for processing
        processedInput = processedInput.slice(1, -1);
        
        // Split by commas, but be careful about nested objects
        const parts = [];
        let currentPart = '';
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = 0; i < processedInput.length; i++) {
          const char = processedInput[i];
          
          if (escapeNext) {
            currentPart += char;
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            currentPart += char;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            currentPart += char;
            continue;
          }
          
          if (!inString) {
            if (char === '{' || char === '[') {
              braceCount++;
            } else if (char === '}' || char === ']') {
              braceCount--;
            } else if (char === ',' && braceCount === 0) {
              parts.push(currentPart.trim());
              currentPart = '';
              continue;
            }
          }
          
          currentPart += char;
        }
        
        if (currentPart.trim()) {
          parts.push(currentPart.trim());
        }
        
        // Process each part to add quotes around unquoted keys
        const processedParts = parts.map(part => {
          const colonIndex = part.indexOf(':');
          if (colonIndex === -1) return part;
          
          const key = part.substring(0, colonIndex).trim();
          const value = part.substring(colonIndex + 1).trim();
          
          // If key is not quoted, add quotes
          let processedKey = key;
          if (!key.startsWith('"') && !key.startsWith("'")) {
            processedKey = `"${key}"`;
          }
          
          return `${processedKey}:${value}`;
        });
        
        // Reconstruct the object
        const validJson = `{${processedParts.join(',')}}`;
        return JSON.parse(validJson);
        
      } catch (secondError) {
        console.warn('Failed to parse flexible object syntax:', input, secondError);
        return {};
      }
    }
  }

  async connectDb({
    connectionDetails,
  }: {
    connectionDetails: ConnectionDetailsType;
  }) {
    try {
      const uri = connectionDetails.connection_string;
      
      this.client = new MongoClient(uri);
      await this.client.connect();
      
      // Try to get database from connection details or URI
      let databaseName = connectionDetails.database;
      
      if (!databaseName) {
        // Extract database name from URI if not provided in connection details
        try {
          const url = new URL(uri);
          databaseName = url.pathname.replace('/', '') || undefined;
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
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to connect to MongoDB",
      };
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }

  isConnectedToDb() {
    return !!this.db;
  }

  async executeQuery(query: string) {
    if (!this.db) {
      return {
        data: null,
        message: null,
        error: "No connection to the database",
      };
    }
    try {
      if (query.startsWith("db.")) {
        const command = query.replace("db.", ""); // Remove 'db.'
        const [collectionName, operation] = command.split(".", 2);

        if (!collectionName || !operation) {
          throw new Error("Invalid command format");
        }

        const collection: any = this.db.collection(collectionName);
        const operationMatch = operation.match(/(\w+)\((.*)\)/);

        if (!operationMatch) {
          throw new Error("Unsupported command");
        }

        const operationName = operationMatch[1];
        const operationArgs = operationMatch[2];

        let parsedArgs = [];
        if (operationArgs.trim()) {
          parsedArgs = JSON.parse(`[${operationArgs}]`); // Convert arguments into array
        }

        if (typeof collection[operationName] === "function") {
          const result = await collection[operationName](
            ...parsedArgs,
          ).toArray();
          return {
            data: { columns: [""], rows: result },
            message: null,
            error: null,
          };
        } else {
          throw new Error(`Unsupported operation: ${operationName}`);
        }
      } else {
        throw new Error("Invalid MongoDB query");
      }
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
      const client = new MongoClient(uri);

      await client.connect();
      await client.close();
      return { success: true, error: null };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getTablesWithFieldsFromDb(currentSchema: string = "", isUpdateSchema: boolean = false) {
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
            customSortBy = this.parseFlexibleObject(filters[0].sortBy.trim());
          } catch (error) {
            console.warn('Invalid sortBy format:', filters[0].sortBy);
          }
        }
        
        // Check if we have a custom query
        const customQueryFilter = filters.find(filter => filter.isCustomQuery && filter.customQuery && filter.customQuery.trim());
        
        if (customQueryFilter && customQueryFilter.customQuery && customQueryFilter.customQuery.trim()) {
          try {
            // Use custom query directly
            filterQuery = this.parseFlexibleObject(customQueryFilter.customQuery.trim());
          } catch (error) {
            console.warn('Invalid custom query format:', customQueryFilter.customQuery);
            filterQuery = {};
          }
        } else {
                    // Process regular filters
          const mongoFilters = filters.map((filter) => {
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
                return { $and: [{ [field]: { $ne: null } }, { [field]: { $ne: "" } }] };
              
              // String operations
              case "equals":
                return { [field]: processValue(value) };
              case "not equals":
                return { [field]: { $ne: processValue(value) } };
              case "contains":
                return { [field]: { $regex: value, $options: "i" } };
              case "not contains":
                return { [field]: { $not: { $regex: value, $options: "i" } } };
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
                return { [field]: { $gte: processValue(value), $lte: processValue(value2) } };
              case "not between":
                return { $or: [{ [field]: { $lt: processValue(value) } }, { [field]: { $gt: processValue(value2) } }] };
              
              // Array operations
              case "in":
                const inValues = value.toString().split(',').map((v: string) => processValue(v.trim()));
                return { [field]: { $in: inValues } };
              case "not in":
                const notInValues = value.toString().split(',').map((v: string) => processValue(v.trim()));
                return { [field]: { $nin: notInValues } };
              
              // Date-specific operations
              case "is today":
                const today = new Date();
                const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
                return { [field]: { $gte: startOfDay, $lt: endOfDay } };
              
              case "is this week":
                const now = new Date();
                const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
                const endOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 7));
                return { [field]: { $gte: startOfWeek, $lt: endOfWeek } };
              
              case "is this month":
                const thisMonth = new Date();
                const startOfMonth = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1);
                const endOfMonth = new Date(thisMonth.getFullYear(), thisMonth.getMonth() + 1, 1);
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
          }).filter((filter): filter is any => filter !== null && Object.keys(filter).length > 0);

          if (mongoFilters.length > 0) {
            filterQuery = mongoFilters.length === 1 ? mongoFilters[0] : { $and: mongoFilters };
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
                [orderBy[0].columnKey]: orderBy[0].direction === "ASC" ? 1 : -1,
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
      let totalUpdated = 0;
      for (const { oldValue, newValue } of data) {
        // For MongoDB, we need to use the _id field for reliable updates
        if (!oldValue._id) {
          continue;
        }

        // Convert _id to ObjectId for the filter
        let filterId;
        try {
          filterId = typeof oldValue._id === 'string' 
            ? ObjectId.createFromHexString(oldValue._id)
            : oldValue._id;
        } catch (error) {
          continue;
        }

        // Create the update document with only changed fields
        const updateDoc: any = {};
        const unsetDoc: any = {};
        
        // Check for fields to update or add
        Object.keys(newValue).forEach(key => {
          if (key !== '_id' && newValue[key] !== oldValue[key]) {
            updateDoc[key] = newValue[key];
          }
        });
        
        // Check for fields that were removed (exist in oldValue but not in newValue)
        // This handles cases where users delete fields from the JSON editor
        Object.keys(oldValue).forEach(key => {
          if (key !== '_id' && !(key in newValue)) {
            unsetDoc[key] = ""; // $unset requires a value, but it's ignored
          }
        });

        // If no fields actually changed or removed, skip this update
        if (Object.keys(updateDoc).length === 0 && Object.keys(unsetDoc).length === 0) {
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
          .updateOne(
            { _id: filterId },
            updateOperation
          );


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
