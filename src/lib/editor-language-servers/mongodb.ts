import { Monaco } from "@monaco-editor/react";

export const mongodbLanguageServer = (
  monaco: Monaco,
  databaseMetadata: any,
) => {
  // Add comprehensive MongoDB type definitions
  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    `
    // MongoDB Collection interface
    interface Collection<T = any> {
      find(filter?: any, options?: any): Cursor<T>;
      findOne(filter?: any, options?: any): Promise<T | null>;
      insertOne(doc: T): Promise<InsertOneResult>;
      insertMany(docs: T[]): Promise<InsertManyResult>;
      updateOne(filter: any, update: any, options?: any): Promise<UpdateResult>;
      updateMany(filter: any, update: any, options?: any): Promise<UpdateResult>;
      deleteOne(filter: any, options?: any): Promise<DeleteResult>;
      deleteMany(filter: any, options?: any): Promise<DeleteResult>;
      replaceOne(filter: any, replacement: T, options?: any): Promise<UpdateResult>;
      aggregate(pipeline: any[], options?: any): AggregationCursor<T>;
      distinct(field: string, filter?: any, options?: any): Promise<any[]>;
      countDocuments(filter?: any, options?: any): Promise<number>;
      estimatedDocumentCount(options?: any): Promise<number>;
      createIndex(keys: any, options?: any): Promise<string>;
      dropIndex(index: string | any, options?: any): Promise<any>;
      getIndexes(): Promise<any[]>;
      listIndexes(options?: any): any;
    }

    // MongoDB Cursor interface
    interface Cursor<T = any> {
      toArray(): Promise<T[]>;
      forEach(fn: (doc: T) => void): Promise<void>;
      map<U>(fn: (doc: T) => U): Cursor<U>;
      filter(fn: (doc: T) => boolean): Cursor<T>;
      limit(limit: number): Cursor<T>;
      skip(skip: number): Cursor<T>;
      sort(sort: any): Cursor<T>;
      count(): Promise<number>;
      hasNext(): Promise<boolean>;
      next(): Promise<T | null>;
      close(): Promise<void>;
    }

    // MongoDB AggregationCursor interface
    interface AggregationCursor<T = any> {
      toArray(): Promise<T[]>;
      forEach(fn: (doc: T) => void): Promise<void>;
      map<U>(fn: (doc: T) => U): AggregationCursor<U>;
      limit(limit: number): AggregationCursor<T>;
      skip(skip: number): AggregationCursor<T>;
      sort(sort: any): AggregationCursor<T>;
      count(): Promise<number>;
      hasNext(): Promise<boolean>;
      next(): Promise<T | null>;
      close(): Promise<void>;
    }

    // MongoDB operation results
    interface InsertOneResult {
      insertedId: any;
      acknowledged: boolean;
    }

    interface InsertManyResult {
      insertedIds: { [key: number]: any };
      acknowledged: boolean;
    }

    interface UpdateResult {
      matchedCount: number;
      modifiedCount: number;
      upsertedCount: number;
      upsertedId?: any;
      acknowledged: boolean;
    }

    interface DeleteResult {
      deletedCount: number;
      acknowledged: boolean;
    }

    // MongoDB Database interface
    interface Db {
      collection<T = any>(name: string): Collection<T>;
      createCollection(name: string, options?: any): Promise<Collection>;
      dropCollection(name: string): Promise<boolean>;
      listCollections(filter?: any, options?: any): any;
      admin(): Admin;
      stats(options?: any): Promise<any>;
      serverStatus(options?: any): Promise<any>;
      runCommand(command: any, options?: any): Promise<any>;
    }

    // MongoDB Admin interface
    interface Admin {
      listDatabases(options?: any): Promise<any>;
      serverStatus(options?: any): Promise<any>;
      buildInfo(options?: any): Promise<any>;
      ping(options?: any): Promise<any>;
    }

    // MongoDB ObjectId
    interface ObjectId {
      toString(): string;
      toHexString(): string;
      equals(other: ObjectId): boolean;
    }

    // MongoDB Date
    interface ISODate {
      toISOString(): string;
      getTime(): number;
    }

    // Global db variable
    declare const db: Db;
    
    // MongoDB utility functions
    declare const ObjectId: (id?: string) => ObjectId;
    declare const ISODate: (date?: string | Date) => ISODate;
    declare const NumberInt: (value: number) => number;
    declare const NumberLong: (value: number) => number;
    declare const NumberDouble: (value: number) => number;
    declare const NumberDecimal: (value: string) => number;
    
    // MongoDB aggregation operators
    interface AggregationOperators {
      $match: (filter: any) => any;
      $group: (group: any) => any;
      $sort: (sort: any) => any;
      $limit: (limit: number) => any;
      $skip: (skip: number) => any;
      $project: (project: any) => any;
      $unwind: (path: string) => any;
      $lookup: (lookup: any) => any;
      $addFields: (fields: any) => any;
      $set: (fields: any) => any;
      $unset: (fields: any) => any;
      $replaceRoot: (root: any) => any;
      $replaceWith: (with: any) => any;
      $merge: (merge: any) => any;
      $out: (collection: string) => any;
      $facet: (facet: any) => any;
      $bucket: (bucket: any) => any;
      $bucketAuto: (bucket: any) => any;
      $sample: (sample: any) => any;
      $redact: (redact: any) => any;
      $indexStats: () => any;
      $listSessions: (list: any) => any;
      $listLocalSessions: (list: any) => any;
      $planCacheStats: () => any;
      $search: (search: any) => any;
      $searchMeta: (search: any) => any;
      $setWindowFields: (window: any) => any;
      $densify: (densify: any) => any;
      $fill: (fill: any) => any;
      $vectorSearch: (vector: any) => any;
    }
    
    // MongoDB query operators
    interface QueryOperators {
      $eq: (value: any) => any;
      $gt: (value: any) => any;
      $gte: (value: any) => any;
      $lt: (value: any) => any;
      $lte: (value: any) => any;
      $ne: (value: any) => any;
      $in: (values: any[]) => any;
      $nin: (values: any[]) => any;
      $and: (conditions: any[]) => any;
      $or: (conditions: any[]) => any;
      $not: (condition: any) => any;
      $nor: (conditions: any[]) => any;
      $exists: (exists: boolean) => any;
      $type: (type: string | number) => any;
      $regex: (pattern: string, options?: string) => any;
      $text: (search: any) => any;
      $where: (where: string | Function) => any;
      $expr: (expr: any) => any;
      $jsonSchema: (schema: any) => any;
      $mod: (mod: [number, number]) => any;
      $all: (values: any[]) => any;
      $elemMatch: (match: any) => any;
      $size: (size: number) => any;
      $bitsAllSet: (bits: number) => any;
      $bitsAnySet: (bits: number) => any;
      $bitsAllClear: (bits: number) => any;
      $bitsAnyClear: (bits: number) => any;
      $geoWithin: (geo: any) => any;
      $geoIntersects: (geo: any) => any;
      $near: (geo: any) => any;
      $nearSphere: (geo: any) => any;
    }
    
    // MongoDB update operators
    interface UpdateOperators {
      $set: (fields: any) => any;
      $unset: (fields: any) => any;
      $inc: (fields: any) => any;
      $mul: (fields: any) => any;
      $rename: (fields: any) => any;
      $min: (fields: any) => any;
      $max: (fields: any) => any;
      $currentDate: (fields: any) => any;
      $addToSet: (fields: any) => any;
      $push: (fields: any) => any;
      $pull: (fields: any) => any;
      $pullAll: (fields: any) => any;
      $pop: (fields: any) => any;
      $bit: (fields: any) => any;
    }
  `,
    "mongodb-types.d.ts",
  );

  // Add autocomplete suggestions for MongoDB
  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    `
    // MongoDB autocomplete suggestions
    const mongoSuggestions = {
      // Collection methods
      find: "Find documents in collection",
      findOne: "Find a single document",
      insertOne: "Insert a single document",
      insertMany: "Insert multiple documents",
      updateOne: "Update a single document",
      updateMany: "Update multiple documents",
      deleteOne: "Delete a single document",
      deleteMany: "Delete multiple documents",
      replaceOne: "Replace a single document",
      aggregate: "Perform aggregation pipeline",
      distinct: "Get distinct values for a field",
      countDocuments: "Count documents matching filter",
      estimatedDocumentCount: "Get estimated document count",
      createIndex: "Create an index",
      dropIndex: "Drop an index",
      getIndexes: "Get all indexes",
      listIndexes: "List all indexes",
      
      // Aggregation stages
      $match: "Filter documents",
      $group: "Group documents",
      $sort: "Sort documents",
      $limit: "Limit number of documents",
      $skip: "Skip number of documents",
      $project: "Select fields to include/exclude",
      $unwind: "Deconstruct array field",
      $lookup: "Join with another collection",
      $addFields: "Add new fields",
      $set: "Set field values",
      $unset: "Remove fields",
      $replaceRoot: "Replace root document",
      $replaceWith: "Replace document",
      $merge: "Merge results into collection",
      $out: "Output results to collection",
      $facet: "Process multiple pipelines",
      $bucket: "Group into buckets",
      $bucketAuto: "Group into automatic buckets",
      $sample: "Random sample of documents",
      $redact: "Restrict document content",
      $indexStats: "Index usage statistics",
      $listSessions: "List sessions",
      $listLocalSessions: "List local sessions",
      $planCacheStats: "Query plan cache statistics",
      $search: "Atlas Search",
      $searchMeta: "Atlas Search metadata",
      $setWindowFields: "Set window fields",
      $densify: "Densify data",
      $fill: "Fill missing values",
      $vectorSearch: "Vector search",
      
      // Query operators
      $eq: "Equal to",
      $gt: "Greater than",
      $gte: "Greater than or equal",
      $lt: "Less than",
      $lte: "Less than or equal",
      $ne: "Not equal",
      $in: "In array",
      $nin: "Not in array",
      $and: "Logical AND",
      $or: "Logical OR",
      $not: "Logical NOT",
      $nor: "Logical NOR",
      $exists: "Field exists",
      $type: "Field type",
      $regex: "Regular expression",
      $text: "Text search",
      $where: "JavaScript expression",
      $expr: "Aggregation expression",
      $jsonSchema: "JSON schema validation",
      $mod: "Modulo operation",
      $all: "All elements match",
      $elemMatch: "Element matches",
      $size: "Array size",
      $bitsAllSet: "All bits set",
      $bitsAnySet: "Any bits set",
      $bitsAllClear: "All bits clear",
      $bitsAnyClear: "Any bits clear",
      $geoWithin: "Within geometry",
      $geoIntersects: "Intersects geometry",
      $near: "Near point",
      $nearSphere: "Near point (spherical)",
      
      // Update operators
      $set: "Set field values",
      $unset: "Remove fields",
      $inc: "Increment field values",
      $mul: "Multiply field values",
      $rename: "Rename fields",
      $min: "Minimum value",
      $max: "Maximum value",
      $currentDate: "Set current date",
      $addToSet: "Add to set",
      $push: "Push to array",
      $pull: "Pull from array",
      $pullAll: "Pull all from array",
      $pop: "Pop from array",
      $bit: "Bitwise operations",
      
      // Utility functions
      ObjectId: "Create ObjectId",
      ISODate: "Create ISODate",
      NumberInt: "Create NumberInt",
      NumberLong: "Create NumberLong",
      NumberDouble: "Create NumberDouble",
      NumberDecimal: "Create NumberDecimal"
    };
  `,
    "mongodb-suggestions.d.ts",
  );

  // Disable default JavaScript suggestions
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    noLib: true,
    allowNonTsExtensions: true,
  });

  // Register completion item provider for MongoDB
  monaco.languages.registerCompletionItemProvider("javascript", {
    provideCompletionItems: () => {
      return {
        suggestions: [
          // Collection methods
          {
            label: "db.collection",
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: 'db.collection("${1:collectionName}")',
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: "Access a MongoDB collection",
            detail: "MongoDB Collection",
          },
        ],
      };
    },
  });
};

export const mongoJsonLanguageServer = async (monaco: any) => {
  try {
    // Import MongoDB functions
    const {
      ObjectId,
      ISODate,
      NumberInt,
      NumberLong,
      NumberDouble,
      NumberDecimal,
      Binary,
      Timestamp,
      RegExp,
      MinKey,
      MaxKey,
      Code,
      DBRef,
    } = await import("@/lib/utils/mongodb-utils");

    // Add MongoDB functions to the editor's global scope
    const mongoFunctions = {
      ObjectId,
      ISODate,
      NumberInt,
      NumberLong,
      NumberDouble,
      NumberDecimal,
      Binary,
      Timestamp,
      RegExp,
      MinKey,
      MaxKey,
      Code,
      DBRef,
    };

    // Make functions available in the editor context
    Object.entries(mongoFunctions).forEach(([name, func]) => {
      // Add to Monaco's global scope
      (monaco as any).global = (monaco as any).global || {};
      (monaco as any).global[name] = func;
    });

    // Add MongoDB snippets for autocomplete
    monaco.languages.registerCompletionItemProvider("json", {
      provideCompletionItems: () => {
        return {
          suggestions: [
            {
              label: "ObjectId",
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'ObjectId("${1:id}")',
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: "Create a MongoDB ObjectId",
              detail: "MongoDB ObjectId constructor",
            },
            {
              label: "ISODate",
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'ISODate("${1:date}")',
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: "Create a MongoDB ISODate",
              detail: "MongoDB ISODate constructor",
            },
            {
              label: "NumberInt",
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: "NumberInt(${1:value})",
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: "Create a MongoDB NumberInt",
              detail: "MongoDB NumberInt constructor",
            },
            {
              label: "NumberLong",
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: "NumberLong(${1:value})",
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: "Create a MongoDB NumberLong",
              detail: "MongoDB NumberLong constructor",
            },
            {
              label: "NumberDouble",
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: "NumberDouble(${1:value})",
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: "Create a MongoDB NumberDouble",
              detail: "MongoDB NumberDouble constructor",
            },
            {
              label: "NumberDecimal",
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'NumberDecimal("${1:value}")',
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: "Create a MongoDB NumberDecimal",
              detail: "MongoDB NumberDecimal constructor",
            },
          ],
        };
      },
    });

    // Configure Monaco to accept MongoDB functions as valid JSON values
    const jsonLanguageService = monaco.languages.json.jsonDefaults;

    // Customize JSON validation to allow MongoDB functions
    jsonLanguageService.setDiagnosticsOptions({
      validate: false, // Disable JSON validation for MongoDB
      allowComments: true,
      schemas: [],
    });
  } catch (error) {
    console.warn("Failed to inject MongoDB functions:", error);
  }
};
