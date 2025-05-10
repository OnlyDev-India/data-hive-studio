import { ConnectionDetailsType } from "@/types/db.type";
import { PaginationType } from "@/types/file.type";
import { FilterType, TableForm } from "@/types/table.type";
import { Collection, CollectionInfo, Db, MongoClient, ObjectId } from "mongodb";
import { cookies } from "next/headers";
import { SortColumn } from "react-data-grid";

export class MongoDbClient {
  conn: { pool: Db | null; client: MongoClient | null };
  connectionString: string | null;

  constructor() {
    this.conn = { pool: null, client: null };
    this.connectionString = null;
  }

  async connectDb({
    connectionDetails,
  }: {
    connectionDetails: ConnectionDetailsType;
  }) {
    try {
      const { connectionString } = connectionDetails;
      if (!connectionString) {
        return {
          success: false,
          error: "Connection string not found",
        };
      }
      if (!this.conn.pool) {
        const client = new MongoClient(connectionString);
        await client.close();
        await client.connect();
        this.conn.client = client;
        const admin = client.db("admin");
        const databases = (await admin.command({ listDatabases: 1 })).databases
          .filter((db: any) => db.name !== "admin" && db.name !== "local")
          .map((db: any) => db.name);
        if (
          connectionDetails.database &&
          databases.includes(connectionDetails.database)
        ) {
          this.conn.pool = client.db(connectionDetails.database);
        } else if (databases.length > 0) {
          this.conn.pool = client.db(databases[0]);
        } else {
          return {
            success: false,
            error: "No database found",
          };
        }

        return {
          success: true,
          error: null,
        };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  isConnectedToDb() {
    return this.conn.pool;
  }

  async executeQuery(query: string) {
    const db = this.conn.pool;
    if (!db) {
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

        const collection: any = db.collection(collectionName);
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
    // try {
    //   const queries = query
    //     .split(";")
    //     .map((q) => q.trim())
    //     .filter((q) => q);
    //   const results = [];

    //   for (const query of queries) {
    //     if (query.toLowerCase().startsWith("select")) {
    //       // Use `all` for SELECT queries
    //       const result = await this.conn.pool.all(query);
    //       results.push(result);
    //     } else {
    //       // Use `run` for other queries
    //       const result = await this.conn.pool.run(query);
    //       results.push({ affectedRows: result.changes });
    //     }
    //   }

    //   if (results.length > 1) {
    //     return {
    //       data: { rows: results },
    //       message: results.length + " Query executed successfully",
    //       error: null,
    //     };
    //   }

    //   return {
    //     data: { rows: results[0] },
    //     message: "Query executed successfully",
    //     error: null,
    //   };
    // } catch (error: any) {
    //   return {
    //     data: null,
    //     message: null,
    //     error: error.message,
    //   };
    // }
  }

  async testConnection({
    connectionDetails,
  }: {
    connectionDetails: ConnectionDetailsType;
  }) {
    try {
      const { connectionString } = connectionDetails;
      if (!connectionString)
        return { success: false, error: "Connection string not found" };
      const client = new MongoClient(connectionString);

      await client.connect();
      await client.close();
      return { success: true, error: null };
    } catch (error: any) {
      console.error("Error:", error);
      return { success: false, error: error.message };
    }
  }

  async getTablesWithFieldsFromDb() {
    const db = this.conn.pool;
    if (!db) return { tables: [], error: "No connection to the database" };
    try {
      const result: CollectionInfo[] = await db.listCollections().toArray();
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
    if (!this.conn.client) {
      return { databases: [], error: "No connection to the database" };
    }
    try {
      // Query to retrieve all databases
      const result = await this.conn.client.db().admin().listDatabases();

      const databases = result.databases
        .filter((db: any) => db.name !== "admin" && db.name !== "local")
        .map((db: any) => ({ database_name: db.name }));

      return { databases: databases || [], error: null };
    } catch (error: any) {
      console.error("Error:", error);
      return { databases: [], error: error.message };
    }
  }
  async getTableRelations(table_name: string) {
    return false as any;
  }
  async getTableColumns(table_name: string) {
    const db = this.conn.pool;
    if (!db) return { columns: null, error: "No connection to the database" };

    try {
      // Use aggregation to get unique fields and their types
      const result = await db
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

      const columns = result.map((field) => ({
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
    const db = this.conn.pool;
    if (!db)
      return {
        data: null,
        error: "No connection to the database",
        totalRecords: 0,
      };
    try {
      const { filters, orderBy, pagination } = options || {};
      const { page, limit } = pagination || { page: 1, limit: 10 };
      const skip = (page - 1) * limit;
      const result = await db
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
      const totalRecords = await db.collection(tableName).countDocuments();
      return { data: result, error: null, totalRecords };
    } catch (error: any) {
      console.error("Error:", error);
      return { data: null, error: error.message, totalRecords: 0 };
    }
  }
  async dropTable(tableName: string) {
    const db = this.conn.pool;
    if (!db) {
      return { data: null, error: "No connection to the database" };
    }

    try {
      // Query to drop the table
      await db.collection(tableName).drop();

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
    const db = this.conn.pool; // Assuming this.conn.pool is a valid MongoDB connection object
    if (!db)
      return {
        data: null,
        effectedRows: null,
        updatedError: "Invalid inputs",
        fetchError: "Invalid inputs",
      };

    try {
      // Use bulkWrite for multiple updates
      const bulkOps = data.map((item) => {
        const copiedItem = JSON.parse(JSON.stringify(item.newValue));
        const copiedOldValue = JSON.parse(JSON.stringify(item.oldValue));
        delete copiedItem._id;
        return {
          updateOne: {
            filter: { _id: ObjectId.createFromHexString(copiedOldValue._id) }, // Match the old document by _id
            update: { $set: copiedItem }, // Set new values
          },
        };
      });

      // Perform bulkWrite to execute all updates at once
      const result = await db.collection(tableName).bulkWrite(bulkOps);
      const { data: updatedData, error: fetchError } =
        await this.getTablesData(tableName);

      return {
        data: updatedData,
        fetchError,
        updatedError: null,
        effectedRows: result.modifiedCount,
      };
    } catch (error: any) {
      console.error("Error:", error);
      return {
        data: null,
        updatedError:
          error.message || "An error occurred while updating the table",
      };
    }
  }
  async deleteTableData(tableName: string, data: any[]) {
    // Check if the database connection exists
    const db = this.conn.pool; // Assuming `this.conn.pool` is your MongoDB connection object
    if (!db) {
      return { data: null, deleteError: "No connection to the database" };
    }

    // Validate the input data
    if (!Array.isArray(data) || data.length === 0) {
      return { data: null, deleteError: "No records provided for deletion" };
    }

    try {
      // Build the deletion filter
      const ids = data.map((item) => ObjectId.createFromHexString(item._id)); // Assuming `_id` is used for deletion
      const result = await db
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
    const db = this.conn.pool; // Assuming `this.conn.pool` is your MongoDB connection object
    if (!db) {
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
      const result = await db.collection(tableName).insertMany(values);

      const newData = await db
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
  async createTable(formData: TableForm) {
    console.log(formData);

    const db = this.conn.pool;

    if (!db) return { data: null, error: "Not connected to database" };

    try {
      // Create a new collection with the provided table name
      await db.createCollection(formData.name);
      return { data: null, error: null };
    } catch {
      return { data: null, error: "An error occurred" };
    }
  }
}
