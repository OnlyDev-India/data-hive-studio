export const pgSqlLanguageServer = (monaco: any, databaseMetadata: any) => {
  monaco.languages.register({ id: "pgsql" });

  const keywords = [
    // DML Commands
    "SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "UPSERT",
    "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "FULL", "INNER", "CROSS",
    "ON", "USING", "AS", "ALIAS",
    "AND", "OR", "NOT", "XOR",
    "NULL", "IS", "IN", "EXISTS", "BETWEEN",
    "LIKE", "ILIKE", "SIMILAR", "REGEXP",
    
    // DDL Commands
    "CREATE", "DROP", "ALTER", "RENAME", "TRUNCATE",
    "TABLE", "VIEW", "INDEX", "SEQUENCE", "SCHEMA", "DATABASE", "EXTENSION",
    "FUNCTION", "PROCEDURE", "TRIGGER", "EVENT", "USER", "ROLE",
    "CONSTRAINT", "PRIMARY", "FOREIGN", "REFERENCES", "UNIQUE", "CHECK",
    "DEFAULT", "IDENTITY", "GENERATED", "ALWAYS",
    
    // DCL Commands
    "GRANT", "REVOKE", "DENY",
    
    // TCL Commands
    "BEGIN", "START", "TRANSACTION", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE",
    
    // Clauses
    "GROUP", "BY", "HAVING", "ORDER", "LIMIT", "OFFSET", "FETCH",
    "DISTINCT", "ALL",
    "WITH", "RECURSIVE", "CTE",
    "CASE", "WHEN", "THEN", "ELSE", "END",
    "UNION", "INTERSECT", "EXCEPT",
    
    // Functions and Operators
    "CAST", "CONVERT",
    "COALESCE", "NULLIF", "GREATEST", "LEAST",
    "EXTRACT", "DATE_TRUNC", "AGE", "NOW", "CURRENT_TIMESTAMP",
    
    // Aggregation
    "COUNT", "SUM", "AVG", "MIN", "MAX", "STDDEV", "VARIANCE",
    "STRING_AGG", "ARRAY_AGG", "JSON_AGG", "JSONB_AGG",
    
    // Window Functions
    "OVER", "PARTITION", "ROWS", "RANGE", "UNBOUNDED", "PRECEDING", "FOLLOWING",
    "ROW_NUMBER", "RANK", "DENSE_RANK", "NTILE", "LAG", "LEAD", "FIRST_VALUE", "LAST_VALUE",
    
    // JSON Functions
    "JSON_EXTRACT", "JSON_SET", "JSON_REMOVE", "JSON_CONTAINS", "JSON_SEARCH",
    "JSON_LENGTH", "JSON_KEYS", "JSON_VALID", "JSON_QUOTE", "JSON_UNQUOTE",
    
    // String Functions
    "CONCAT", "SUBSTRING", "REPLACE", "UPPER", "LOWER", "TRIM", "LTRIM", "RTRIM",
    "LENGTH", "CHAR_LENGTH", "POSITION", "INSTR", "REVERSE", "REPEAT",
    
    // Math Functions
    "ABS", "CEIL", "FLOOR", "ROUND", "TRUNC", "MOD", "POWER", "SQRT", "EXP", "LN", "LOG",
    
    // Date/Time Functions
    "CURRENT_DATE", "CURRENT_TIME", "LOCALTIME", "LOCALTIMESTAMP",
    "DATE_ADD", "DATE_SUB", "DATEDIFF", "TIMESTAMPDIFF",
    
    // Conditional
    "IF", "IFNULL",
    
    // Other
    "EXPLAIN", "ANALYZE", "VACUUM", "REINDEX", "CLUSTER", "REFRESH", "MATERIALIZED"
  ];

  const typeKeywords = [
    // Numeric Types
    "SMALLINT", "INTEGER", "INT", "BIGINT", "SERIAL", "BIGSERIAL", "SMALLSERIAL",
    "DECIMAL", "NUMERIC", "REAL", "DOUBLE", "PRECISION", "FLOAT", "MONEY",
    
    // Character Types
    "CHAR", "CHARACTER", "VARCHAR", "TEXT", "NCHAR", "NVARCHAR",
    
    // Binary Types
    "BYTEA", "BLOB",
    
    // Date/Time Types
    "DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "INTERVAL",
    
    // Boolean Type
    "BOOLEAN", "BOOL",
    
    // Geometric Types
    "POINT", "LINE", "LSEG", "BOX", "PATH", "POLYGON", "CIRCLE",
    
    // Network Types
    "INET", "CIDR", "MACADDR", "MACADDR8",
    
    // UUID Type
    "UUID",
    
    // JSON Types
    "JSON", "JSONB",
    
    // Array Types
    "ARRAY",
    
    // Range Types
    "INT4RANGE", "INT8RANGE", "NUMRANGE", "TSRANGE", "TSTZRANGE", "DATERANGE",
    
    // Other Types
    "BIT", "XML", "TSVECTOR", "TSQUERY", "CITEXT", "HSTORE"
  ];

  const operators = [
    // Comparison Operators
    "=", "<", ">", "<=", ">=", "<>", "!=", "!<", "!>",
    
    // Arithmetic Operators
    "+", "-", "*", "/", "%", "||", "::",
    
    // Bitwise Operators
    "&", "|", "^", "~", "<<", ">>",
    
    // Range Operators
    "&&", "@>", "<@", "&<", "&>", "<<=", ">>=",
    
    // JSON Operators
    "->", "->>", "#>", "#>>", "?&", "?|", "#-"
  ];

  // Define Monarch tokenizer for PostgreSQL syntax highlighting
  monaco.languages.setMonarchTokensProvider("pgsql", {
    defaultToken: "invalid",
    tokenPostfix: ".pgsql",

    // Define keywords and types
    keywords,
    typeKeywords,
    operators,

    // Tokenizer
    tokenizer: {
      root: [
        // Comments (must come first to avoid conflicts)
        [/--.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        
        // Strings
        [/'/, "string", "@string"],
        [/"/, "string", "@string_double"],
        
        // Keywords - use a simpler approach
        [/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|ON|AS|AND|OR|NOT|NULL|CREATE|DROP|ALTER|TABLE|VIEW|INDEX|SEQUENCE|SCHEMA|DATABASE|GRANT|REVOKE|PRIMARY|KEY|FOREIGN|REFERENCES|DEFAULT|CHECK|UNIQUE|CONSTRAINT|TRIGGER|FUNCTION|RETURNING|GROUP|BY|HAVING|DISTINCT|LIMIT|OFFSET|ORDER|ASC|DESC|WITH|CASE|WHEN|THEN|ELSE|END|CAST|IS|IN|EXISTS|MERGE|UPSERT|LEFT|RIGHT|FULL|INNER|CROSS|USING|ALIAS|XOR|BETWEEN|LIKE|ILIKE|SIMILAR|REGEXP|UNION|INTERSECT|EXCEPT|OVER|PARTITION|ROWS|RANGE|UNBOUNDED|PRECEDING|FOLLOWING|ROW_NUMBER|RANK|DENSE_RANK|NTILE|LAG|LEAD|FIRST_VALUE|LAST_VALUE|COALESCE|NULLIF|GREATEST|LEAST|EXTRACT|DATE_TRUNC|AGE|NOW|CURRENT_TIMESTAMP|COUNT|SUM|AVG|MIN|MAX|STDDEV|VARIANCE|STRING_AGG|ARRAY_AGG|JSON_AGG|JSONB_AGG|CONCAT|SUBSTRING|REPLACE|UPPER|LOWER|TRIM|LTRIM|RTRIM|LENGTH|CHAR_LENGTH|POSITION|INSTR|REVERSE|REPEAT|ABS|CEIL|FLOOR|ROUND|TRUNC|MOD|POWER|SQRT|EXP|LN|LOG|CURRENT_DATE|CURRENT_TIME|LOCALTIME|LOCALTIMESTAMP|IF|IFNULL|EXPLAIN|ANALYZE|VACUUM|REINDEX|CLUSTER|REFRESH|MATERIALIZED|BEGIN|START|TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|DENY|RENAME|TRUNCATE|EXTENSION|PROCEDURE|EVENT|USER|ROLE|IDENTITY|GENERATED|ALWAYS|DISTINCT|RECURSIVE|CTE|CONVERT|DATE_ADD|DATE_SUB|DATEDIFF|TIMESTAMPDIFF)\b/i, "keyword"],
        
        // Data types
        [/\b(SMALLINT|INTEGER|INT|BIGINT|SERIAL|BIGSERIAL|SMALLSERIAL|DECIMAL|NUMERIC|REAL|DOUBLE|PRECISION|FLOAT|MONEY|CHAR|CHARACTER|VARCHAR|TEXT|NCHAR|NVARCHAR|BYTEA|BLOB|DATE|TIME|TIMESTAMP|TIMESTAMPTZ|INTERVAL|BOOLEAN|BOOL|POINT|LINE|LSEG|BOX|PATH|POLYGON|CIRCLE|INET|CIDR|MACADDR|MACADDR8|UUID|JSON|JSONB|ARRAY|INT4RANGE|INT8RANGE|NUMRANGE|TSRANGE|TSTZRANGE|DATERANGE|BIT|XML|TSVECTOR|TSQUERY|CITEXT|HSTORE)\b/i, "type"],
        
        // Numbers
        [/\b\d+(\.\d+)?\b/, "number"],
        
        // Operators - simplified and more specific
        [/[=<>!+\-*/%&|^~@#?]/, "operator"],
        [/<=|>=|<>|!=|!<|!>|\|\||::|&&|<<|>>|<<=|>>=|->|->>|#>|#>>|\?&|\?\|/, "operator"],
        
        // Brackets and punctuation
        [/[{}()\[\]]/, "@brackets"],
        [/[;,]/, "delimiter"],
        
        // Identifiers
        [/[a-zA-Z_]\w*/, "identifier"],
      ],
      
      comment: [
        [/[^*/]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/./, "comment"]
      ],
      
      string: [
        [/[^']+/, "string"],
        [/''/, "string"],
        [/'/, "string", "@pop"]
      ],
      
      string_double: [
        [/[^"]+/, "string"],
        [/""/, "string"],
        [/"/, "string", "@pop"]
      ]
    },
  });

  // Function to create suggestions dynamically based on metadata
  const createSuggestions = (metadata: any) => {
    const suggestions: any = [];
    try {
      // Add table names and columns
      const { schemasWithTables } = metadata;

      Object.keys(schemasWithTables).forEach((schema) => {
        schemasWithTables[schema].forEach((table: any) => {
          // Table suggestions
          suggestions.push({
            label: `"${schema}"."${table.table_name}"`,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: `"${schema}"."${table.table_name}"`,
            detail: `Table in schema "${schema}"`,
            documentation: `Table: ${table.table_name} in schema ${schema}`,
          });

          suggestions.push({
            label: `"${table.table_name}"`,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: `"${table.table_name}"`,
            detail: `Table in schema "${schema}"`,
            documentation: `Table: ${table.table_name} in schema ${schema}`,
          });

          // Column suggestions if available
          if (table.columns) {
            table.columns.forEach((column: any) => {
              suggestions.push({
                label: `${column.column_name}`,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: `"${column.column_name}"`,
                detail: `Column: ${column.data_type || 'unknown type'}`,
                documentation: `Column ${column.column_name} from table ${table.table_name}`,
              });
            });
          }
        });

        // Schema suggestions
        suggestions.push({
          label: `"${schema}"`,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: `"${schema}"`,
          detail: `Schema: ${schema}`,
          documentation: `Database schema: ${schema}`,
        });
      });

      // Add comprehensive PostgreSQL commands and functions
      const pgCommands = [
        // DML Commands
        { label: "SELECT", snippet: "SELECT ${1:*} FROM ${2:table} WHERE ${3:condition}" },
        { label: "INSERT", snippet: "INSERT INTO ${1:table} (${2:columns}) VALUES (${3:values})" },
        { label: "UPDATE", snippet: "UPDATE ${1:table} SET ${2:column} = ${3:value} WHERE ${4:condition}" },
        { label: "DELETE", snippet: "DELETE FROM ${1:table} WHERE ${2:condition}" },
        { label: "MERGE", snippet: "MERGE INTO ${1:target_table} USING ${2:source_table} ON ${3:condition}" },
        
        // DDL Commands
        { label: "CREATE TABLE", snippet: "CREATE TABLE ${1:table_name} (\n  ${2:column_name} ${3:data_type} ${4:constraints}\n)" },
        { label: "CREATE VIEW", snippet: "CREATE VIEW ${1:view_name} AS ${2:SELECT_statement}" },
        { label: "CREATE INDEX", snippet: "CREATE INDEX ${1:index_name} ON ${2:table_name} (${3:columns})" },
        { label: "CREATE FUNCTION", snippet: "CREATE OR REPLACE FUNCTION ${1:function_name}(${2:parameters}) RETURNS ${3:return_type} AS $$\n  ${4:function_body}\n$$ LANGUAGE ${5:plpgsql}" },
        
        // Common Patterns
        { label: "SELECT with JOIN", snippet: "SELECT ${1:columns} FROM ${2:table1} JOIN ${3:table2} ON ${4:join_condition} WHERE ${5:condition}" },
        { label: "SELECT with GROUP BY", snippet: "SELECT ${1:columns} FROM ${2:table} GROUP BY ${3:group_columns} HAVING ${4:having_condition}" },
        { label: "SELECT with ORDER BY", snippet: "SELECT ${1:columns} FROM ${2:table} ORDER BY ${3:order_columns} LIMIT ${4:limit}" },
        { label: "INSERT multiple rows", snippet: "INSERT INTO ${1:table} (${2:columns}) VALUES\n  (${3:values1}),\n  (${4:values2})" },
        
        // Window Functions
        { label: "ROW_NUMBER()", snippet: "ROW_NUMBER() OVER (ORDER BY ${1:column})" },
        { label: "RANK()", snippet: "RANK() OVER (PARTITION BY ${1:partition_column} ORDER BY ${2:order_column})" },
        { label: "LAG()", snippet: "LAG(${1:column}, ${2:offset}) OVER (ORDER BY ${3:order_column})" },
        
        // CTEs
        { label: "WITH CTE", snippet: "WITH ${1:cte_name} AS (\n  ${2:SELECT_statement}\n)\nSELECT * FROM ${1:cte_name}" },
        
        // JSON Functions
        { label: "JSON_EXTRACT", snippet: "JSON_EXTRACT(${1:json_column}, '${2:$.path}')" },
        { label: "JSON_SET", snippet: "JSON_SET(${1:json_column}, '${2:$.path}', ${3:value})" },
        
        // Date Functions
        { label: "EXTRACT", snippet: "EXTRACT(${1:YEAR|MONTH|DAY} FROM ${2:date_column})" },
        { label: "DATE_TRUNC", snippet: "DATE_TRUNC('${1:day|month|year}', ${2:date_column})" },
        
        // Aggregation Functions
        { label: "COUNT", snippet: "COUNT(${1:column})" },
        { label: "SUM", snippet: "SUM(${1:column})" },
        { label: "AVG", snippet: "AVG(${1:column})" },
        { label: "STRING_AGG", snippet: "STRING_AGG(${1:column}, '${2:separator}')" },
        
        // Conditional Functions
        { label: "CASE", snippet: "CASE WHEN ${1:condition} THEN ${2:result} ELSE ${3:else_result} END" },
        { label: "COALESCE", snippet: "COALESCE(${1:column}, ${2:default_value})" },
        { label: "NULLIF", snippet: "NULLIF(${1:expression1}, ${2:expression2})" },
        
        // String Functions
        { label: "CONCAT", snippet: "CONCAT(${1:string1}, ${2:string2})" },
        { label: "SUBSTRING", snippet: "SUBSTRING(${1:string} FROM ${2:start} FOR ${3:length})" },
        { label: "REPLACE", snippet: "REPLACE(${1:string}, ${2:search}, ${3:replace})" },
        
        // Math Functions
        { label: "ROUND", snippet: "ROUND(${1:number}, ${2:decimals})" },
        { label: "CEIL", snippet: "CEIL(${1:number})" },
        { label: "FLOOR", snippet: "FLOOR(${1:number})" },
        
        // Transaction Control
        { label: "BEGIN", snippet: "BEGIN;" },
        { label: "COMMIT", snippet: "COMMIT;" },
        { label: "ROLLBACK", snippet: "ROLLBACK;" },
        { label: "SAVEPOINT", snippet: "SAVEPOINT ${1:savepoint_name};" },
        
        // Utility Commands
        { label: "EXPLAIN", snippet: "EXPLAIN (ANALYZE, BUFFERS) ${1:query}" },
        { label: "VACUUM", snippet: "VACUUM (ANALYZE) ${1:table_name};" },
        { label: "REINDEX", snippet: "REINDEX TABLE ${1:table_name};" }
      ];

      pgCommands.forEach((command) => {
        suggestions.push({
          label: command.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: command.snippet,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: `SQL Command: ${command.label}`,
          documentation: `Insert ${command.label} with placeholders`,
        });
      });

      // Add data type suggestions (only unique ones)
      const uniqueTypes = typeKeywords.filter((type, index, self) => self.indexOf(type) === index);
      uniqueTypes.forEach((type) => {
        suggestions.push({
          label: type,
          kind: monaco.languages.CompletionItemKind.TypeParameter,
          insertText: type,
          detail: `Data Type: ${type}`,
          documentation: `PostgreSQL data type: ${type}`,
        });
      });

      // Add operator suggestions (only unique ones)
      const uniqueOperators = operators.filter((op, index, self) => self.indexOf(op) === index);
      uniqueOperators.forEach((op) => {
        suggestions.push({
          label: op,
          kind: monaco.languages.CompletionItemKind.Operator,
          insertText: op,
          detail: `Operator: ${op}`,
          documentation: `PostgreSQL operator: ${op}`,
        });
      });

      // Add basic keyword suggestions (only for keywords not covered by snippets)
      const snippetLabels = pgCommands.map(cmd => cmd.label);
      const basicKeywords = keywords.filter(keyword => !snippetLabels.includes(keyword));
      
      basicKeywords.forEach((keyword) => {
        suggestions.push({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          detail: `Keyword: ${keyword}`,
          documentation: `PostgreSQL keyword: ${keyword}`,
        });
      });

    } catch (error) {
      console.error("Error creating PostgreSQL suggestions:", error);
    } finally {
      return suggestions;
    }
  };

  // Register completion item provider
  monaco.languages.registerCompletionItemProvider("pgsql", {
    provideCompletionItems: () => {
      // Generate suggestions dynamically
      const suggestions = createSuggestions(databaseMetadata);
      return { suggestions };
    },
  });

  // Register hover provider for better documentation
  monaco.languages.registerHoverProvider("pgsql", {
    provideHover: (model: any, position: any) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const wordText = word.word.toUpperCase();
      
      // Check if it's a keyword
      if (keywords.includes(wordText)) {
        return {
          contents: [
            { value: `**${wordText}**` },
            { value: `PostgreSQL keyword` }
          ]
        };
      }
      
      // Check if it's a data type
      if (typeKeywords.includes(wordText)) {
        return {
          contents: [
            { value: `**${wordText}**` },
            { value: `PostgreSQL data type` }
          ]
        };
      }
      
      return null;
    }
  });
};
