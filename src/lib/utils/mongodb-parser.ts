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

// /**
//  * Parse data with MongoDB function call strings
//  * @param data - Data object with function call strings
//  * @returns Parsed data with evaluated functions
//  */
// export const parseMongoFunctionCalls = (data: any): any => {
//   try {
//     // Create context with MongoDB functions
//     const mongoContext = createMongoContext();

//     // Recursively process the data to evaluate function calls
//     const processValue = (value: any): any => {
//       if (typeof value === "string") {
//         // Check if it's a function call
//         if (value.startsWith("ObjectId(") && value.endsWith(")")) {
//           // Extract the ID from ObjectId("...")
//           const id = value.match(/ObjectId\("([^"]+)"\)/)?.[1];
//           if (id) {
//             return ObjectId(id);
//           }
//         } else if (value.startsWith("ISODate(") && value.endsWith(")")) {
//           // Extract the date from ISODate("...")
//           const date = value.match(/ISODate\("([^"]+)"\)/)?.[1];
//           if (date) {
//             return ISODate(date);
//           }
//         } else if (value.startsWith("NumberInt(") && value.endsWith(")")) {
//           // Extract the number from NumberInt(...)
//           const num = value.match(/NumberInt\(([^)]+)\)/)?.[1];
//           if (num) {
//             return NumberInt(num);
//           }
//         } else if (value.startsWith("NumberLong(") && value.endsWith(")")) {
//           // Extract the number from NumberLong(...)
//           const num = value.match(/NumberLong\(([^)]+)\)/)?.[1];
//           if (num) {
//             return NumberLong(num);
//           }
//         } else if (value.startsWith("NumberDouble(") && value.endsWith(")")) {
//           // Extract the number from NumberDouble(...)
//           const num = value.match(/NumberDouble\(([^)]+)\)/)?.[1];
//           if (num) {
//             return NumberDouble(num);
//           }
//         } else if (value.startsWith("NumberDecimal(") && value.endsWith(")")) {
//           // Extract the number from NumberDecimal(...)
//           const num = value.match(/NumberDecimal\(([^)]+)\)/)?.[1];
//           if (num) {
//             return NumberDecimal(num);
//           }
//         } else if (value.startsWith("Binary(") && value.endsWith(")")) {
//           // Extract the argument from Binary(...)
//           const arg = value.match(/Binary\("([^"]+)"\)/)?.[1];
//           if (arg) {
//             return Binary(arg);
//           }
//         } else if (value.startsWith("RegExp(") && value.endsWith(")")) {
//           // Extract the arguments from RegExp(...)
//           const match = value.match(/RegExp\("([^"]+)",\s*"([^"]*)"\)/);
//           if (match) {
//             return RegExp(match[1], match[2]);
//           } else {
//             // Try without options
//             const arg = value.match(/RegExp\("([^"]+)"\)/)?.[1];
//             if (arg) {
//               return RegExp(arg);
//             }
//           }
//         }
//         // If not a function call, return as is
//         return value;
//       } else if (Array.isArray(value)) {
//         return value.map(processValue);
//       } else if (value && typeof value === "object") {
//         const processed: any = {};
//         for (const [key, val] of Object.entries(value)) {
//           processed[key] = processValue(val);
//         }
//         return processed;
//       }
//       return value;
//     };

//     // Process the entire data object
//     const processed = processValue(data);

//     // Convert the processed result back to regular format
//     return convertFromMongoFormat(processed);
//   } catch (error) {
//     throw new Error(`Failed to parse MongoDB function calls: ${error}`);
//   }
// };

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
  console.log("🔄 convertDataToEditor called with:", { data, columnMetadata });

  if (!data || typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => convertDataToEditor(item, columnMetadata));
  }

  const converted: any = {};

  for (const [key, value] of Object.entries(data)) {
    const columnType = columnMetadata?.[key]?.toLowerCase() || "";
    console.log(
      `🔍 Processing key: "${key}", value: "${value}", columnType: "${columnType}"`,
    );

    // Use column metadata to determine the appropriate MongoDB function
    if (columnType.includes("objectid")) {
      // Convert to ObjectId function call string
      converted[key] = `ObjectId("${value}")`;
    } else if (
      columnType.includes("date") ||
      columnType.includes("timestamp")
    ) {
      // Convert to ISODate function call string
      converted[key] = `ISODate("${value}")`;
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

    console.log(
      `✅ Converted "${key}": ${typeof converted[key]}`,
      converted[key],
    );
  }

  console.log("🔄 Final editor format result:", converted);
  return converted;
};

/**
 * Custom stringifier that converts MongoDB function call strings to unquoted function calls
 * @param data - Data with function call strings
 * @returns Formatted string with unquoted MongoDB functions
 */
export const stringifyWithMongoFunctions = (data: any, indent: number = 0): string => {
  const spaces = '  '.repeat(indent);
  
  if (data === null) return 'null';
  if (data === undefined) return 'undefined';
  if (typeof data === 'string') {
    // Check if it's a MongoDB function call string
    if (data.startsWith('ObjectId(') && data.endsWith(')')) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith('ISODate(') && data.endsWith(')')) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith('NumberInt(') && data.endsWith(')')) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith('NumberLong(') && data.endsWith(')')) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith('NumberDouble(') && data.endsWith(')')) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith('NumberDecimal(') && data.endsWith(')')) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith('Binary(') && data.endsWith(')')) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith('RegExp(') && data.endsWith(')')) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith('Timestamp(') && data.endsWith(')')) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith('Code(') && data.endsWith(')')) {
      // Return as unquoted function call
      return data;
    } else if (data.startsWith('DBRef(') && data.endsWith(')')) {
      // Return as unquoted function call
      return data;
    } else {
      // Regular string, quote it
      return `"${data}"`;
    }
  }
  if (typeof data === 'number') return data.toString();
  if (typeof data === 'boolean') return data.toString();
  
  if (Array.isArray(data)) {
    if (data.length === 0) return '[]';
    const items = data.map(item => stringifyWithMongoFunctions(item, indent + 1));
    return `[\n${spaces}  ${items.join(`,\n${spaces}  `)}\n${spaces}]`;
  }
  
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 0) return '{}';
    
    const items = keys.map(key => {
      const value = stringifyWithMongoFunctions(data[key], indent + 1);
      return `${spaces}  "${key}": ${value}`;
    });
    
    return `{\n${items.join(',\n')}\n${spaces}}`;
  }
  
  return String(data);
};
