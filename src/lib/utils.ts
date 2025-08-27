import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Utility functions for MongoDB query parsing and validation
 * 
 * These utilities handle MongoDB's flexible syntax that allows both quoted and unquoted field names.
 * They can be imported and used anywhere in the application for parsing MongoDB queries.
 * 
 * @example
 * ```typescript
 * import { parseMongoDBSyntax, safeParseMongoDB, isValidMongoDBSyntax } from '@/lib/utils';
 * 
 * // Parse a MongoDB query with flexible syntax
 * const query = parseMongoDBSyntax('{name:{$exists:false}}');
 * 
 * // Safely parse with fallback to strict JSON
 * const result = safeParseMongoDB('{age:{$gt:18}}');
 * 
 * // Validate syntax before parsing
 * if (isValidMongoDBSyntax(userInput)) {
 *   const parsed = parseMongoDBSyntax(userInput);
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // Usage in form validation
 * function validateFilter(filter: string) {
 *   const isValid = isValidMongoDBSyntax(filter);
 *   return { isValid, error: isValid ? undefined : 'Invalid MongoDB syntax' };
 * }
 * 
 * // Usage in API endpoints
 * function processQuery(queryString: string) {
 *   try {
 *     const parsed = parseMongoDBSyntax(queryString);
 *     return { success: true, data: parsed };
 *   } catch (error) {
 *     return { success: false, error: 'Invalid query' };
 *   }
 * }
 * ```
 */

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Utility function to parse MongoDB-style flexible object syntax
 * Handles both quoted {"name":{"$exists":false}} and unquoted {name:{$exists:false}} syntax
 * 
 * @param input - The string to parse (MongoDB-style object syntax)
 * @returns Parsed object or empty object if parsing fails
 * 
 * @example
 * ```typescript
 * // Quoted syntax (valid JSON)
 * parseMongoDBSyntax('{"name":{"$exists":false}}')
 * 
 * // Unquoted syntax (MongoDB-style)
 * parseMongoDBSyntax('{name:{$exists:false}}')
 * 
 * // Mixed syntax
 * parseMongoDBSyntax('{"name":{$exists:false}}')
 * 
 * // Complex nested
 * parseMongoDBSyntax('{filter:{name:{$exists:false},age:{$gt:18}}}')
 * ```
 */
export function parseMongoDBSyntax(input: string): any {
  if (!input || typeof input !== 'string') return {};
  
  try {
    // First try standard JSON parsing
    return JSON.parse(input);
  } catch (error) {
    try {
      // If JSON parsing fails, try to convert MongoDB-style syntax to valid JSON
      let processedInput = input.trim();
      
      // Handle edge cases
      if (!processedInput.startsWith('{') || !processedInput.endsWith('}')) {
        throw new Error('Invalid object format');
      }
      
      // Remove outer braces for processing
      processedInput = processedInput.slice(1, -1);
      
      // Split by commas, but be careful about nested objects and arrays
      const parts = [];
      let currentPart = '';
      let braceCount = 0;
      let bracketCount = 0;
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
          if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
          } else if (char === '[') {
            bracketCount++;
          } else if (char === ']') {
            bracketCount--;
          } else if (char === ',' && braceCount === 0 && bracketCount === 0) {
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
        
        // Handle nested objects and arrays in values
        let processedValue = value;
        if (value.startsWith('{') && value.endsWith('}')) {
          // Recursively process nested objects
          try {
            const nestedObj = parseMongoDBSyntax(value);
            processedValue = JSON.stringify(nestedObj);
          } catch {
            // If nested parsing fails, keep original value
            processedValue = value;
          }
        } else if (value.startsWith('[') && value.endsWith(']')) {
          // Handle arrays - try to parse as flexible array
          try {
            const arrayContent = value.slice(1, -1);
            const arrayParts = arrayContent.split(',').map(item => item.trim());
            const processedArray = arrayParts.map(item => {
              if (item.startsWith('{') && item.endsWith('}')) {
                return parseMongoDBSyntax(item);
              }
              return item;
            });
            processedValue = JSON.stringify(processedArray);
          } catch {
            // If array parsing fails, keep original value
            processedValue = value;
          }
        }
        
        return `${processedKey}:${processedValue}`;
      });
      
      // Reconstruct the object
      const validJson = `{${processedParts.join(',')}}`;
      return JSON.parse(validJson);
      
    } catch (secondError) {
      // If all parsing attempts fail, return empty object
      console.warn('Failed to parse flexible MongoDB syntax:', input, secondError);
      return {};
    }
  }
}

/**
 * Utility function to safely parse MongoDB queries with fallback
 * Tries flexible parsing first, then falls back to strict JSON parsing
 * 
 * @param input - The string to parse
 * @param fallbackToStrict - Whether to fall back to strict JSON parsing (default: true)
 * @returns Parsed object or null if all parsing attempts fail
 * 
 * @example
 * ```typescript
 * // Will try flexible parsing first, then strict JSON
 * const result = safeParseMongoDB('{name:{$exists:false}}');
 * 
 * // Will only try flexible parsing
 * const result = safeParseMongoDB('{name:{$exists:false}}', false);
 * ```
 */
export function safeParseMongoDB(input: string, fallbackToStrict: boolean = true): any | null {
  try {
    // Try flexible parsing first
    const result = parseMongoDBSyntax(input);
    if (Object.keys(result).length > 0) {
      return result;
    }
    
    // If flexible parsing returns empty object and fallback is enabled, try strict JSON
    if (fallbackToStrict) {
      try {
        return JSON.parse(input);
      } catch (strictError) {
        return null;
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Utility function to validate if a string is valid MongoDB syntax
 * 
 * @param input - The string to validate
 * @returns true if valid MongoDB syntax, false otherwise
 * 
 * @example
 * ```typescript
 * isValidMongoDBSyntax('{name:{$exists:false}}') // true
 * isValidMongoDBSyntax('{invalid syntax}') // false
 * ```
 */
export function isValidMongoDBSyntax(input: string): boolean {
  try {
    const result = parseMongoDBSyntax(input);
    return result && typeof result === 'object' && Object.keys(result).length > 0;
  } catch {
    return false;
  }
}
