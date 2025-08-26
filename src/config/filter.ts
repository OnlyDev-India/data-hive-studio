export const compareFilter = [
  // Universal operators (work with all data types)
  { key: "equals", value: "equals", types: ["all"] },
  { key: "not equals", value: "not equals", types: ["all"] },
  { key: "is null", value: "is null", types: ["all"] },
  { key: "is not null", value: "is not null", types: ["all"] },
  
  // String operators
  { key: "contains", value: "contains", types: ["text", "varchar", "char", "string"] },
  { key: "not contains", value: "not contains", types: ["text", "varchar", "char", "string"] },
  { key: "starts with", value: "starts with", types: ["text", "varchar", "char", "string"] },
  { key: "ends with", value: "ends with", types: ["text", "varchar", "char", "string"] },
  { key: "regex", value: "regex", types: ["text", "varchar", "char", "string"] },
  { key: "like", value: "like", types: ["text", "varchar", "char", "string"] },
  { key: "not like", value: "not like", types: ["text", "varchar", "char", "string"] },
  
  // Numeric operators (integer, decimal, float, double)
  { key: "greater than", value: "greater than", types: ["integer", "decimal", "float", "double", "numeric", "bigint", "smallint"] },
  { key: "less than", value: "less than", types: ["integer", "decimal", "float", "double", "numeric", "bigint", "smallint"] },
  { key: "greater than or equal", value: "greater than or equal", types: ["integer", "decimal", "float", "double", "numeric", "bigint", "smallint"] },
  { key: "less than or equal", value: "less than or equal", types: ["integer", "decimal", "float", "double", "numeric", "bigint", "smallint"] },
  { key: "between", value: "between", types: ["integer", "decimal", "float", "double", "numeric", "bigint", "smallint"] },
  { key: "not between", value: "not between", types: ["integer", "decimal", "float", "double", "numeric", "bigint", "smallint"] },
  { key: "in", value: "in", types: ["integer", "decimal", "float", "double", "numeric", "bigint", "smallint"] },
  { key: "not in", value: "not in", types: ["integer", "decimal", "float", "double", "numeric", "bigint", "smallint"] },
  
  // Date/Time operators
  { key: "greater than", value: "greater than", types: ["timestamp", "timestamp without time zone", "timestamp with time zone", "date", "time", "datetime"] },
  { key: "less than", value: "less than", types: ["timestamp", "timestamp without time zone", "timestamp with time zone", "date", "time", "datetime"] },
  { key: "greater than or equal", value: "greater than or equal", types: ["timestamp", "timestamp without time zone", "timestamp with time zone", "date", "time", "datetime"] },
  { key: "less than or equal", value: "less than or equal", types: ["timestamp", "timestamp without time zone", "timestamp with time zone", "date", "time", "datetime"] },
  { key: "between", value: "between", types: ["timestamp", "timestamp without time zone", "timestamp with time zone", "date", "time", "datetime"] },
  { key: "not between", value: "not between", types: ["timestamp", "timestamp without time zone", "timestamp with time zone", "date", "time", "datetime"] },
  { key: "in", value: "in", types: ["timestamp", "timestamp without time zone", "timestamp with time zone", "date", "time", "datetime"] },
  { key: "not in", value: "not in", types: ["timestamp", "timestamp without time zone", "timestamp with time zone", "date", "time", "datetime"] },
  { key: "is today", value: "is today", types: ["timestamp", "timestamp without time zone", "timestamp with time zone", "date", "datetime"] },
  { key: "is this week", value: "is this week", types: ["timestamp", "timestamp without time zone", "timestamp with time zone", "date", "datetime"] },
  { key: "is this month", value: "is this month", types: ["timestamp", "timestamp without time zone", "timestamp with time zone", "date", "datetime"] },
  { key: "is this year", value: "is this year", types: ["timestamp", "timestamp without time zone", "timestamp with time zone", "date", "datetime"] },
  
  // Boolean operators
  { key: "is true", value: "is true", types: ["boolean", "bool"] },
  { key: "is false", value: "is false", types: ["boolean", "bool"] },
  
  // Array operators
  { key: "contains", value: "contains", types: ["array", "json"] },
  { key: "not contains", value: "not contains", types: ["array", "json"] },
  { key: "is empty", value: "is empty", types: ["array", "json"] },
  { key: "is not empty", value: "is not empty", types: ["array", "json"] },
  { key: "has length", value: "has length", types: ["array", "json"] },
];
