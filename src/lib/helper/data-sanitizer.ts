/**
 * Data sanitization utilities for cleaning up data before database operations
 * 
 * IMPORTANT: Tables without primary keys require special attention!
 * 
 * When updating tables without primary keys, the system uses fallback strategies:
 * 1. Primary Keys (most reliable) ✅
 * 2. Unique Constraints (good alternative) ✅  
 * 3. ID Field (common convention) ✅
 * 4. Composite NOT NULL columns (moderate risk) ⚠️
 * 5. All non-null fields (high risk) ❌
 * 
 * Examples:
 * 
 * Table with Primary Key:
 *   - Strategy: Use primary key(s)
 *   - Safety: High - single row updates guaranteed
 * 
 * Table with Unique Constraints:
 *   - Strategy: Use unique constraint(s)
 *   - Safety: High - single row updates guaranteed
 * 
 * Table with ID field:
 *   - Strategy: Use ID field (assumed unique)
 *   - Safety: High - single row updates likely
 * 
 * Table without identifiers:
 *   - Strategy: Use composite NOT NULL columns
 *   - Safety: Medium - may affect multiple rows if data is duplicated
 * 
 * Table with minimal structure:
 *   - Strategy: Use all non-null fields
 *   - Safety: Low - high risk of affecting multiple rows
 */

export interface SanitizationOptions {
  convertEmptyStringsToNull?: boolean;
  convertUndefinedStringsToUndefined?: boolean;
  convertBooleanStrings?: boolean;
  removeUndefinedValues?: boolean;
  removeNullValues?: boolean;
}

/**
 * Sanitizes a single value based on the provided options
 */
export function sanitizeValue(value: any, options: SanitizationOptions = {}): any {
  const {
    convertEmptyStringsToNull = true,
    convertUndefinedStringsToUndefined = true,
    convertBooleanStrings = true,
    removeUndefinedValues = false,
    removeNullValues = false,
  } = options;

  // Convert "$undefined" strings back to undefined
  if (convertUndefinedStringsToUndefined && 
      (value === "$undefined" || value === "undefined")) {
    return undefined;
  }

  // Convert empty strings to null
  if (convertEmptyStringsToNull && value === "") {
    return null;
  }

  // Ensure boolean values are properly typed
  if (convertBooleanStrings && typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
  }

  // Remove undefined values if requested
  if (removeUndefinedValues && value === undefined) {
    return undefined;
  }

  // Remove null values if requested
  if (removeNullValues && value === null) {
    return undefined;
  }

  return value;
}

/**
 * Sanitizes an object by cleaning up all its values
 */
export function sanitizeObject(obj: Record<string, any>, options: SanitizationOptions = {}): Record<string, any> {
  const sanitizedObj: Record<string, any> = {};
  
  Object.keys(obj).forEach(key => {
    const value = sanitizeValue(obj[key], options);
    
    // Only add the key if the value is not undefined (unless explicitly allowed)
    if (value !== undefined || !options.removeUndefinedValues) {
      sanitizedObj[key] = value;
    }
  });
  
  return sanitizedObj;
}

/**
 * Sanitizes an array of objects
 */
export function sanitizeObjectsArray(arr: Record<string, any>[], options: SanitizationOptions = {}): Record<string, any>[] {
  return arr.map(obj => sanitizeObject(obj, options));
}

/**
 * Sanitizes data specifically for database update operations
 */
export function sanitizeForDatabaseUpdate(
  oldValue: Record<string, any>, 
  newValue: Record<string, any>
): { oldValue: Record<string, any>; newValue: Record<string, any> } {
  return {
    oldValue: sanitizeObject(oldValue, {
      convertEmptyStringsToNull: true,
      convertUndefinedStringsToUndefined: true,
      convertBooleanStrings: true,
      removeUndefinedValues: false,
      removeNullValues: false,
    }),
    newValue: sanitizeObject(newValue, {
      convertEmptyStringsToNull: true,
      convertUndefinedStringsToUndefined: true,
      convertBooleanStrings: true,
      removeUndefinedValues: false, // Keep undefined values for proper comparison
      removeNullValues: false,
    }),
  };
}

/**
 * Sanitizes data specifically for database insert operations
 */
export function sanitizeForDatabaseInsert(data: Record<string, any>[]): Record<string, any>[] {
  return sanitizeObjectsArray(data, {
    convertEmptyStringsToNull: true,
    convertUndefinedStringsToUndefined: true,
    convertBooleanStrings: true,
    removeUndefinedValues: true, // Remove undefined values for inserts
    removeNullValues: false,
  });
}

/**
 * Analyzes table structure to determine the best update strategy
 */
export function analyzeTableUpdateStrategy(columns: any[]): {
  hasPrimaryKey: boolean;
  hasUniqueConstraints: boolean;
  hasIdField: boolean;
  recommendedStrategy: string;
  warning?: string;
} {
  const primaryKeys = columns.filter(col => col.key_type === 'PRIMARY KEY');
  const uniqueColumns = columns.filter(col => col.key_type === 'UNIQUE' || col.is_unique);
  const hasIdField = columns.some(col => col.column_name === 'id' && col.is_nullable === 'NO');
  const notNullColumns = columns.filter(col => col.is_nullable === 'NO');
  
  let recommendedStrategy = '';
  let warning: string | undefined;
  
  if (primaryKeys.length > 0) {
    recommendedStrategy = `Use primary key(s): ${primaryKeys.map(pk => pk.column_name).join(', ')}`;
  } else if (uniqueColumns.length > 0) {
    recommendedStrategy = `Use unique constraint(s): ${uniqueColumns.map(uc => uc.column_name).join(', ')}`;
    warning = 'No primary key found. Using unique constraints may be less reliable.';
  } else if (hasIdField) {
    recommendedStrategy = 'Use id field (assumed unique)';
    warning = 'No primary key or unique constraints found. Using id field as fallback.';
  } else if (notNullColumns.length > 0) {
    recommendedStrategy = `Use composite identifier: ${notNullColumns.slice(0, 3).map(col => col.column_name).join(', ')}`;
    warning = 'No primary key, unique constraints, or id field found. Using NOT NULL columns as composite identifier. This may cause unintended updates.';
  } else {
    recommendedStrategy = 'Use all non-null fields as identifier';
    warning = 'WARNING: No reliable identifier found. Updates may affect multiple rows unexpectedly.';
  }
  
  return {
    hasPrimaryKey: primaryKeys.length > 0,
    hasUniqueConstraints: uniqueColumns.length > 0,
    hasIdField,
    recommendedStrategy,
    warning
  };
}

/**
 * Validates if an update operation is safe based on table structure
 */
export function validateUpdateSafety(
  oldValue: Record<string, any>, 
  newValue: Record<string, any>,
  columns: any[]
): {
  isSafe: boolean;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
} {
  const strategy = analyzeTableUpdateStrategy(columns);
  
  if (strategy.hasPrimaryKey) {
    return {
      isSafe: true,
      reason: 'Primary key ensures single row update',
      riskLevel: 'low'
    };
  }
  
  if (strategy.hasUniqueConstraints) {
    return {
      isSafe: true,
      reason: 'Unique constraints provide reliable identification',
      riskLevel: 'low'
    };
  }
  
  if (strategy.hasIdField) {
    return {
      isSafe: true,
      reason: 'ID field provides reliable identification',
      riskLevel: 'low'
    };
  }
  
  // Check if we have enough non-null fields for composite identification
  const nonNullFields = Object.keys(oldValue).filter(key => 
    oldValue[key] !== null && oldValue[key] !== undefined
  );
  
  if (nonNullFields.length >= 3) {
    return {
      isSafe: false,
      reason: 'Using composite identifier without unique constraints',
      riskLevel: 'medium'
    };
  }
  
  return {
    isSafe: false,
    reason: 'Insufficient identifying information for safe update',
    riskLevel: 'high'
  };
}

/**
 * Generates example SQL queries to show how different table structures are handled
 */
export function generateUpdateExamples(tableName: string, columns: any[]): {
  scenario: string;
  strategy: string;
  exampleSQL: string;
  riskLevel: 'low' | 'medium' | 'high';
  explanation: string;
}[] {
  const examples: any[] = [];
  
  // Example 1: Table with Primary Key
  if (columns.some(col => col.key_type === 'PRIMARY KEY')) {
    const primaryKeys = columns.filter(col => col.key_type === 'PRIMARY KEY');
    const pkFields = primaryKeys.map(pk => pk.column_name).join(', ');
    
    examples.push({
      scenario: "Table with Primary Key",
      strategy: `Use primary key(s): ${pkFields}`,
      exampleSQL: `UPDATE ${tableName} SET "name" = 'Updated Value' WHERE "${primaryKeys[0].column_name}" = 'some-id';`,
      riskLevel: 'low',
      explanation: "Primary keys guarantee unique row identification. This is the safest approach."
    });
  }
  
  // Example 2: Table with Unique Constraints
  if (columns.some(col => col.key_type === 'UNIQUE' || col.is_unique)) {
    const uniqueColumns = columns.filter(col => col.key_type === 'UNIQUE' || col.is_unique);
    const uniqueFields = uniqueColumns.map(uc => uc.column_name).join(', ');
    
    examples.push({
      scenario: "Table with Unique Constraints",
      strategy: `Use unique constraint(s): ${uniqueFields}`,
      exampleSQL: `UPDATE ${tableName} SET "name" = 'Updated Value' WHERE "${uniqueColumns[0].column_name}" = 'unique-value';`,
      riskLevel: 'low',
      explanation: "Unique constraints ensure only one row matches. Very reliable for updates."
    });
  }
  
  // Example 3: Table with ID field
  if (columns.some(col => col.column_name === 'id' && col.is_nullable === 'NO')) {
    examples.push({
      scenario: "Table with ID Field",
      strategy: "Use id field (assumed unique)",
      exampleSQL: `UPDATE ${tableName} SET "name" = 'Updated Value' WHERE "id" = 123;`,
      riskLevel: 'low',
      explanation: "ID fields are commonly used as unique identifiers. Generally safe."
    });
  }
  
  // Example 4: Table without proper identifiers
  const notNullColumns = columns.filter(col => col.is_nullable === 'NO');
  if (notNullColumns.length > 0 && !columns.some(col => col.key_type === 'PRIMARY KEY' || col.key_type === 'UNIQUE')) {
    const compositeFields = notNullColumns.slice(0, 3).map(col => col.column_name);
    const whereClause = compositeFields.map(field => `"${field}" = 'value'`).join(' AND ');
    
    examples.push({
      scenario: "Table without Primary Key or Unique Constraints",
      strategy: `Use composite identifier: ${compositeFields.join(', ')}`,
      exampleSQL: `UPDATE ${tableName} SET "name" = 'Updated Value' WHERE ${whereClause};`,
      riskLevel: 'medium',
      explanation: "Using multiple NOT NULL columns as composite identifier. May affect multiple rows if data is duplicated."
    });
  }
  
  // Example 5: Worst case scenario
  if (notNullColumns.length === 0) {
    examples.push({
      scenario: "Table with No Constraints",
      strategy: "Use all non-null fields as identifier",
      exampleSQL: `UPDATE ${tableName} SET "name" = 'Updated Value' WHERE "field1" = 'value1' AND "field2" = 'value2' AND "field3" = 'value3';`,
      riskLevel: 'high',
      explanation: "WARNING: No reliable identifiers. This query may affect multiple rows unexpectedly. Consider adding constraints to the table."
    });
  }
  
  return examples;
}
