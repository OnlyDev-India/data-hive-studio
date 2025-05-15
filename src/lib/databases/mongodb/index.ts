import { ConnectionDetailsType, DatabaseClient } from "@/types/db.type";
import { PaginationType } from "@/types/file.type";
import { FilterType, TableForm } from "@/types/table.type";
import { Collection, CollectionInfo, Db, MongoClient, ObjectId } from "mongodb";
import { cookies } from "next/headers";
import { SortColumn } from "react-data-grid";

export class MongoDbClient implements DatabaseClient {
  private client: MongoClient | null = null;
  private db: any = null;

  async connectDb({ connectionDetails }: { connectionDetails: ConnectionDetailsType }) {
    try {
      const uri = connectionDetails.connection_string;
      this.client = new MongoClient(uri);
      await this.client.connect();
      this.db = this.client.db();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to connect to MongoDB",
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
    return this.db;
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
      console.error("Error:", error);
      return { success: false, error: error.message };
    }
  }

  async getTablesWithFieldsFromDb() {
    if (!this.db) return { tables: [], error: "No connection to the database" };
    try {
      const result: CollectionInfo[] = await this.db.listCollections().toArray();
      const collections = result.map((collection) => ({
        table_name: collection.name,
        fields: [],
      }));

      return { tables: collections, error: null };
    } catch (error: any) {
      console.error("Error:", error);
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
      console.error("Error:", error);
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
    if (!this.db) return { columns: null, error: "No connection to the database" };

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

      const columns = result.map((field:any) => ({
        column_name: field._id,
        data_type: field.data_types?.[0], // Array of possible types due to MongoDB's flexible schema
      }));

      return { columns, error: null };
    } catch (error: any) {
      console.error("Error:", error);
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
      const result = await this.db
        .collection(tableName)
        .find({})
        .skip(skip)
        .limit(limit)
        .sort(
          orderBy && orderBy?.length > 0
            ? {
                [orderBy[0].columnKey]: orderBy[0].direction === "ASC" ? 1 : -1,
              }
            : {},
        )
        .toArray();
      const totalRecords = await this.db.collection(tableName).countDocuments();
      return { data: result, error: null, totalRecords };
    } catch (error: any) {
      console.error("Error:", error);
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
      console.error("Error dropping table:", error);
      return { data: null, error: error.message };
    }
  }

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
        const result = await this.db
          .collection(tableName)
          .updateMany(oldValue, { $set: newValue });
        totalUpdated += result.modifiedCount;
      }

      const { data: updatedData, error: fetchError } = await this.getTablesData(tableName);

      return {
        data: updatedData,
        effectedRows: totalUpdated,
        updatedError: null,
        fetchError,
      };
    } catch (error: any) {
      console.error("Error updating records:", error);
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
      console.error("Error deleting records:", error);
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
      console.error("Error inserting records:", error);
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
          .filter(col => col.keyType === "PRIMARY")
          .map(col => ({ key: { [col.name]: 1 }, unique: true }));

        if (indexes.length > 0) {
          await this.db.collection(data.name).createIndexes(indexes);
        }
      }

      return { data: [], error: null };
    } catch (error: any) {
      console.error("Error creating collection:", error);
      return { data: null, error: error.message };
    }
  }
}
