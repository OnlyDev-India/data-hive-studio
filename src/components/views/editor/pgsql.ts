export const pgSqlLanguageServer = (monaco: any, databaseMetadata: any) => {
  monaco.languages.register({ id: "pgSql" });

  const keywords = [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "FROM",
    "WHERE",
    "JOIN",
    "ON",
    "AS",
    "AND",
    "OR",
    "NOT",
    "NULL",
    "CREATE",
    "DROP",
    "ALTER",
    "TABLE",
    "VIEW",
    "INDEX",
    "SEQUENCE",
    "SCHEMA",
    "DATABASE",
    "GRANT",
    "REVOKE",
    "PRIMARY",
    "KEY",
    "FOREIGN",
    "REFERENCES",
    "DEFAULT",
    "CHECK",
    "UNIQUE",
    "CONSTRAINT",
    "TRIGGER",
    "FUNCTION",
    "RETURNING",
    "GROUP",
    "BY",
    "HAVING",
    "DISTINCT",
    "LIMIT",
    "OFFSET",
    "ORDER",
    "ASC",
    "DESC",
    "WITH",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "CAST",
    "IS",
    "IN",
    "EXISTS",
  ];

  const typeKeywords = [
    "BOOLEAN",
    "CHAR",
    "VARCHAR",
    "TEXT",
    "SMALLINT",
    "INTEGER",
    "BIGINT",
    "DECIMAL",
    "NUMERIC",
    "REAL",
    "DOUBLE",
    "SERIAL",
    "BIGSERIAL",
    "DATE",
    "TIME",
    "TIMESTAMP",
    "INTERVAL",
    "ARRAY",
    "JSON",
    "UUID",
  ];

  const operators = [
    "=",
    "<",
    ">",
    "<=",
    ">=",
    "<>",
    "!=",
    "+",
    "-",
    "*",
    "/",
    "%",
    "||",
    "::",
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
        // Keywords
        [new RegExp(`\\b(${keywords.join("|")})\\b`, "i"), "keyword"],

        // Data types
        [new RegExp(`\\b(${typeKeywords.join("|")})\\b`, "i"), "type"],

        // Operators
        [
          new RegExp(
            `(${[
              "=",
              "<",
              ">",
              "<=",
              ">=",
              "<>",
              "!=",
              "\\+",
              "-",
              "\\*",
              "/",
              "%",
              "\\|\\|",
              "::",
            ].join("|")})`,
            "i",
          ),
          "operator",
        ],

        // Brackets and punctuation
        [/[{}()\[\]]/, "@brackets"],
        [/[;,]/, "delimiter"],

        // Strings
        [/'.*?'/, "string"],
        [/".*?"/, "string"],

        // Numbers
        [/\b\d+(\.\d+)?\b/, "number"],

        // Comments
        [/--.*$/, "comment"],
        [/\/\*.*?\*\//, "comment"],
      ],
    },
  });

  // Function to create suggestions dynamically based on metadata
  const createSuggestions = (metadata: any) => {
    const suggestions: any = [];
    try {
      // Add table names
      const { schemasWithTables } = metadata;

      Object.keys(schemasWithTables).forEach((schema) => {
        schemasWithTables[schema].forEach((table: any) => {
          suggestions.push({
            label: `"${schema}"."${table.table_name}"`,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: `"${schema}"."${table.table_name}"`,
            detail: `Table in schema "${schema}"`,
          });

          // Optionally include just the table name for convenience
          suggestions.push({
            label: `"${table.table_name}"`,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: `"${table.table_name}"`,
            detail: `Table in schema "${schema}"`,
          });
        });
        suggestions.push({
          label: `"${schema}"`,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `"${schema}"`,
          detail: `schema"`,
        });
      });

      // Add PostgreSQL commands
      const pgCommands = [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "CREATE",
        "DROP",
        "ALTER",
        "TABLE",
        "VIEW",
        "INDEX",
        "FUNCTION",
        "TRIGGER",
        "SEQUENCE",
        "SCHEMA",
        "DATABASE",
        "GRANT",
        "REVOKE",
        "COMMIT",
        "ROLLBACK",
        "SAVEPOINT",
      ];

      pgCommands.forEach((command) => {
        suggestions.push({
          label: command,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: command,
        });
      });
    } catch {
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
};
