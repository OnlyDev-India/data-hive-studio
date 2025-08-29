/**
 * MongoDB Editor Helper
 * This file provides functions that create executable MongoDB function calls
 * that can be used directly in the Monaco editor
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

/**
 * Create an ObjectId function call that can be executed
 * @param id - The ObjectId string
 * @returns A function that returns the ObjectId
 */
export const createObjectIdCall = (id: string) => {
  return () => ObjectId(id);
};

/**
 * Create an ISODate function call that can be executed
 * @param dateString - The date string
 * @returns A function that returns the ISODate
 */
export const createISODateCall = (dateString: string) => {
  return () => ISODate(dateString);
};

/**
 * Create a NumberInt function call that can be executed
 * @param value - The number value
 * @returns A function that returns the NumberInt
 */
export const createNumberIntCall = (value: number) => {
  return () => NumberInt(value);
};

/**
 * Create a NumberLong function call that can be executed
 * @param value - The number value
 * @returns A function that returns the NumberLong
 */
export const createNumberLongCall = (value: number) => {
  return () => NumberLong(value);
};

/**
 * Create a NumberDouble function call that can be executed
 * @param value - The number value
 * @returns A function that returns the NumberDouble
 */
export const createNumberDoubleCall = (value: number) => {
  return () => NumberDouble(value);
};

/**
 * Execute all functions in the data and return the actual values
 * @param data - Data with executable functions
 * @returns Data with executed function results
 */
export const executeFunctions = (data: any): any => {
  if (!data || typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => executeFunctions(item));
  }

  const executed: any = {};

  for (const [key, value] of Object.entries(data)) {
    console.log(`🔍 Processing key: "${key}", value: "${value}"`);
    if (typeof value === "function") {
      // Execute the function
      executed[key] = value();
    } else if (typeof value === "object" && value !== null) {
      // Recursively execute functions in nested objects
      executed[key] = executeFunctions(value);
    } else {
      // Keep other values as is
      executed[key] = value;
    }
  }

  return executed;
};

// /**
//  * Convert executable functions to displayable function call strings for the editor
//  * @param data - Data with executable functions
//  * @returns Data with function call strings for display
//  */
// export const convertToDisplayFormat = (
//   data: any,
//   columnMetadata: Record<string, string>,
// ): any => {
//   if (!data || typeof data !== "object") return data;

//   if (Array.isArray(data)) {
//     return data.map((item) => convertToDisplayFormat(item, columnMetadata));
//   }

//   const displayData: any = {};

//   for (const [key, value] of Object.entries(data)) {
//     if (typeof value === "function") {
//       // Execute the function to get the actual MongoDB object, then convert to display format
//       const mongoObject = value();
//       const columnType = columnMetadata?.[key]?.toLowerCase() || "";

//       // Convert MongoDB object to display format
//       if (
//         mongoObject &&
//         typeof mongoObject === "object" &&
//         !Array.isArray(mongoObject)
//       ) {
//         if ("$numberInt" in mongoObject) {
//           displayData[key] = `NumberInt(${mongoObject.$numberInt})`;
//         } else if ("$numberLong" in mongoObject) {
//           displayData[key] = `NumberLong(${mongoObject.$numberLong})`;
//         } else if ("$numberDouble" in mongoObject) {
//           displayData[key] = `NumberDouble(${mongoObject.$numberDouble})`;
//         } else if ("$numberDecimal" in mongoObject) {
//           displayData[key] = `NumberDecimal("${mongoObject.$numberDecimal}")`;
//         } else if ("$binary" in mongoObject) {
//           displayData[key] =
//             `Binary("${mongoObject.$binary.base64}",${mongoObject.$binary.subType})`;
//         } else if ("$regularExpression" in mongoObject) {
//           const regex = mongoObject.$regularExpression;
//           displayData[key] = `RegExp("${regex.pattern}", "${regex.options}")`;
//         } else if ("$timestamp" in mongoObject) {
//           displayData[key] =
//             `Timestamp(${mongoObject.$timestamp.t},${mongoObject.$timestamp.i})`;
//         } else if ("$code" in mongoObject) {
//           displayData[key] =
//             `Code("${mongoObject.$code}",${mongoObject.$scope})`;
//         } else if ("$ref" in mongoObject) {
//           displayData[key] =
//             `DBRef("${mongoObject.$ref}",${mongoObject.$id},${mongoObject.$db})`;
//         } else {
//           // Generic MongoDB object
//           displayData[key] = JSON.stringify(mongoObject);
//         }
//       } else {
//         if (columnType.includes("objectid")) {
//           displayData[key] = `ObjectId("${mongoObject}")`;
//         } else if (columnType.includes("date")) {
//           displayData[key] = `ISODate("${mongoObject}")`;
//         } else {
//           // Fallback for non-MongoDB objects
//           displayData[key] = JSON.stringify(mongoObject);
//         }
//       }
//     } else if (typeof value === "object" && value !== null) {
//       // Recursively convert nested objects
//       displayData[key] = convertToDisplayFormat(value, columnMetadata);
//     } else {
//       // Keep other values as is
//       displayData[key] = value;
//     }
//   }

//   return displayData;
// };

export const createBinaryCall = (data: string) => {
  return () => Binary(data);
};

export const createRegExpCall = (pattern: string) => {
  return () => RegExp(pattern);
};
