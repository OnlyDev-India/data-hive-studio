/**
 * Custom MongoDB Parser
 * Parses MongoDB-style JSON with functions like ObjectId(), ISODate(), etc.
 * Does NOT use JSON.parse
 */

import {
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
} from "./mongodb-utils";

// Create a context with all MongoDB functions
const createMongoContext = () => {
  return {
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
};

/**
 * Custom parser for MongoDB-style JSON
 * @param text - The text to parse
 * @returns Parsed object
 */
export const parseMongoJSON = (text: string): any => {
  try {
    // Create context with MongoDB functions
    const mongoContext = createMongoContext();

    // Create a function that evaluates the text with MongoDB functions available
    const parseFunction = new Function(
      ...Object.keys(mongoContext),
      `return ${text};`,
    );

    // Execute the function with MongoDB functions as parameters
    const result = parseFunction(...Object.values(mongoContext));

    // Return the raw MongoDB objects, don't convert them yet
    return result;
  } catch (error) {
    throw new Error(`Failed to parse MongoDB JSON: ${error}`);
  }
};

/**
 * Safely parse MongoDB JSON with error handling
 * @param text - The text to parse
 * @returns Object with parsed data and validation status
 */
export const safeParseMongoJSON = (
  text: string,
): {
  success: boolean;
  data?: any;
  error?: string;
  errorLine?: number;
} => {
  try {
    const data = parseMongoJSON(text);
    return { success: true, data };
  } catch (error: any) {
    // Try to extract line number from error
    const lineMatch = error.message.match(/line (\d+)/i);
    const errorLine = lineMatch ? parseInt(lineMatch[1]) : 0;

    return {
      success: false,
      error: error.message,
      errorLine,
    };
  }
};

/**
 * Convert data TO editor format (normal data → function calls)
 * Used in useEffect when opening the modal
 * @param data - The normal data to convert
 * @param columnMetadata - Column metadata with data types
 * @returns Data with function call strings for the editor
 */
export const convertDataToEditor = (
  data: any,
  columnMetadata?: Record<string, string>,
): any => {
  if (!data || typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => convertDataToEditor(item, columnMetadata));
  }

  const converted: any = {};

  for (const [key, value] of Object.entries(data)) {
    const columnType = columnMetadata?.[key]?.toLowerCase() || "";

    // Use column metadata to determine the appropriate MongoDB function
    if (columnType.includes("objectid")) {
      // Convert to ObjectId function call string
      converted[key] = `ObjectId("${value}")`;
    } else if (
      columnType.includes("date") ||
      columnType.includes("timestamp")
    ) {
      // Convert to ISODate function call string
      if (typeof value === "string" || value instanceof Date) {
        const date = value instanceof Date ? value : value ? new Date(value) : new Date();
        if (isNaN(date.getTime())) {
          converted[key] = `ISODate("${value}")`;
        } else {
          converted[key] = `ISODate("${date.toISOString()}")`;
        }
      } else {
        converted[key] = `ISODate("${value}")`;
      }
    } else if (columnType.includes("int") || columnType.includes("integer")) {
      // Convert to NumberInt function call string
      converted[key] = `NumberInt(${value})`;
    } else if (columnType.includes("long")) {
      // Convert to NumberLong function call string
      converted[key] = `NumberLong(${value})`;
    } else if (columnType.includes("double") || columnType.includes("float")) {
      // Convert to NumberDouble function call string
      converted[key] = `NumberDouble(${value})`;
    } else if (columnType.includes("decimal")) {
      // Convert to NumberDecimal function call string
      converted[key] = `NumberDecimal("${value}")`;
    } else if (columnType.includes("binary")) {
      // Convert to Binary function call string
      converted[key] = `Binary("${value}")`;
    } else if (columnType.includes("regex")) {
      // Convert to RegExp function call string
      converted[key] = `RegExp("${value}")`;
    } else if (typeof value === "object" && value !== null) {
      // Recursively convert nested objects
      converted[key] = convertDataToEditor(value, columnMetadata);
    } else {
      // Keep other values as is
      converted[key] = value;
    }
  }

  return converted;
};

/**
 * Custom stringifier that converts MongoDB function call strings to unquoted function calls
 * @param data - Data with function call strings
 * @returns Formatted string with unquoted MongoDB functions
 */
export const stringifyWithMongoFunctions = (
  data: any,
  indent: number = 0,
): string => {
  const spaces = "  ".repeat(indent);

  if (data === null) return "null";
  if (data === undefined) return "undefined";
  if (typeof data === "string") {
    // Check if it's a MongoDB function call string
    if (data.startsWith("ObjectId(") && data.endsWith(")")) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith("ISODate(") && data.endsWith(")")) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith("NumberInt(") && data.endsWith(")")) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith("NumberLong(") && data.endsWith(")")) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith("NumberDouble(") && data.endsWith(")")) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith("NumberDecimal(") && data.endsWith(")")) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith("Binary(") && data.endsWith(")")) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith("RegExp(") && data.endsWith(")")) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith("Timestamp(") && data.endsWith(")")) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith("Code(") && data.endsWith(")")) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith("DBRef(") && data.endsWith(")")) {
      // Return as unquoted function call
      return data;
    } else {
      // Regular string, quote it
      return `"${data}"`;
    }
  }
  if (typeof data === "number") return data.toString();
  if (typeof data === "boolean") return data.toString();

  if (Array.isArray(data)) {
    if (data.length === 0) return "[]";
    const items = data.map((item) =>
      stringifyWithMongoFunctions(item, indent + 1),
    );
    return `[\n${spaces}  ${items.join(`,\n${spaces}  `)}\n${spaces}]`;
  }

  if (typeof data === "object") {
    const keys = Object.keys(data);
    if (keys.length === 0) return "{}";

    const items = keys.map((key) => {
      const value = stringifyWithMongoFunctions(data[key], indent + 1);
      return `${spaces}  "${key}": ${value}`;
    });

    return `{\n${items.join(",\n")}\n${spaces}}`;
  }

  return String(data);
};
