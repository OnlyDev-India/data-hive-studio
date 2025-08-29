export const mongodbLanguageServer = (monaco: any, databaseMetadata: any) => {
  monaco.languages.register({ id: "mongodb" });

  // Define MongoDB keywords (only those without snippets)
  const keywords = [
    // Query Operators
    "and",
    "or",
    "not",
    "nor",
    "in",
    "nin",
    "exists",
    "type",
    "mod",
    "regex",
    "text",
    "expr",
    "jsonSchema",
    "geoWithin",
    "geoIntersects",
    "near",
    "nearSphere",

    // Comparison Operators
    "eq",
    "gt",
    "gte",
    "lt",
    "lte",
    "ne",
    "all",
    "elemMatch",
    "size",

    // Aggregation Pipeline Stages
    "facet",
    "bucket",
    "bucketAuto",
    "collation",
    "indexStats",
    "listSessions",
    "listLocalSessions",
    "merge",
    "out",
    "planCacheStats",
    "redact",
    "sample",
    "search",
    "searchMeta",
    "setWindowFields",
    "densify",
    "fill",
    "vectorSearch",

    // Aggregation Operators
    "stdDevPop",
    "stdDevSamp",
    "mergeObjects",
    "accumulator",
    "function",
    "init",
    "reduce",

    // Array Operators
    "arrayElemAt",
    "arrayToObject",
    "concatArrays",
    "indexOfArray",
    "isArray",
    "objectToArray",
    "range",
    "reverseArray",
    "slice",
    "zip",

    // String Operators
    "indexOfBytes",
    "indexOfCP",
    "ltrim",
    "rtrim",
    "trim",
    "substrBytes",
    "substrCP",
    "strLenBytes",
    "strLenCP",
    "regexFind",
    "regexFindAll",
    "regexMatch",

    // Date Operators
    "dateAdd",
    "dateDiff",
    "dateFromParts",
    "dateFromString",
    "dateToParts",
    "dayOfMonth",
    "dayOfWeek",
    "dayOfYear",
    "hour",
    "isoDayOfWeek",
    "isoWeek",
    "isoWeekYear",
    "millisecond",
    "minute",
    "second",
    "toDate",
    "week",
    "year",
    "dateTrunc",
    "dateFromIsoWeekYear",
    "dateFromIsoWeek",

    // Math Operators
    "ln",
    "log",
    "log10",
    "multiply",
    "pow",

    // Type Operators
    "isNumber",
    "isString",
    "isDate",
    "isArray",
    "isObject",
    "isBoolean",
    "isNull",
    "isUndefined",
    "isObjectId",
    "isBinData",
    "isRegex",
    "isTimestamp",

    // Variable Operators
    "vars",
    "setIntersection",
    "setUnion",
    "setDifference",
    "setEquals",
    "setIsSubset",

    // Other
    "collection",
    "admin",
    "cloneCollection",
    "copyDatabase",
    "repairDatabase",
    "validate",
    "compact",
    "touch",
  ];

  // Define MongoDB data types (only those with snippets)
  const typeKeywords = [
    "ObjectId",
    "ISODate",
    "NumberInt",
    "NumberLong",
    "NumberDecimal",
    "NumberDouble",
  ];

  // Define MongoDB operators
  const operators = [
    // Comparison
    "$eq",
    "$gt",
    "$gte",
    "$lt",
    "$lte",
    "$ne",
    "$in",
    "$nin",

    // Logical
    "$and",
    "$or",
    "$not",
    "$nor",

    // Element
    "$exists",
    "$type",

    // Evaluation
    "$expr",
    "$jsonSchema",
    "$mod",
    "$regex",
    "$text",
    "$where",

    // Geospatial
    "$geoWithin",
    "$geoIntersects",
    "$near",
    "$nearSphere",
    "$maxDistance",
    "$minDistance",
    "$geometry",
    "$center",
    "$centerSphere",
    "$box",
    "$polygon",

    // Array
    "$all",
    "$elemMatch",
    "$size",
    "$slice",

    // Bitwise
    "$bitsAllSet",
    "$bitsAnySet",
    "$bitsAllClear",
    "$bitsAnyClear",

    // Comments
    "$comment",
    "$hint",
    "$maxTimeMS",
    "$orderby",
    "$query",
    "$returnKey",
    "$showRecordId",
    "$natural",
  ];

  // Define Monarch tokenizer for MongoDB syntax highlighting
  monaco.languages.setMonarchTokensProvider("mongodb", {
    defaultToken: "invalid",
    tokenPostfix: ".mongodb",

    // Define keywords and types
    keywords,
    typeKeywords,
    operators,

    // Tokenizer
    tokenizer: {
      root: [
        // Comments
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],

        // Strings
        [/'/, "string", "@string"],
        [/"/, "string", "@string_double"],

                 // Keywords - only those without snippets
         [
           /\b(and|or|not|nor|in|nin|exists|type|mod|regex|text|expr|jsonSchema|geoWithin|geoIntersects|near|nearSphere|eq|gt|gte|lt|lte|ne|all|elemMatch|size|facet|bucket|bucketAuto|collation|indexStats|listSessions|listLocalSessions|merge|out|planCacheStats|redact|sample|search|searchMeta|setWindowFields|densify|fill|vectorSearch|stdDevPop|stdDevSamp|mergeObjects|accumulator|function|init|reduce|arrayElemAt|arrayToObject|concatArrays|indexOfArray|isArray|objectToArray|range|reverseArray|slice|zip|indexOfBytes|indexOfCP|ltrim|rtrim|trim|substrBytes|substrCP|strLenBytes|strLenCP|regexFind|regexFindAll|regexMatch|dateAdd|dateDiff|dateFromParts|dateFromString|dateToParts|dayOfMonth|dayOfWeek|dayOfYear|hour|isoDayOfWeek|isoWeek|isoWeekYear|millisecond|minute|second|toDate|week|year|dateTrunc|dateFromIsoWeekYear|dateFromIsoWeek|ln|log|log10|multiply|pow|isNumber|isString|isDate|isArray|isObject|isBoolean|isNull|isUndefined|isObjectId|isBinData|isRegex|isTimestamp|vars|setIntersection|setUnion|setDifference|setEquals|setIsSubset|collection|admin|cloneCollection|copyDatabase|repairDatabase|validate|compact|touch)\b/i,
           "keyword",
         ],

                 // Data types
         [
           /\b(ObjectId|ISODate|NumberInt|NumberLong|NumberDecimal|NumberDouble)\b/i,
           "type",
         ],

        // Operators
        [/\$[a-zA-Z_]\w*/, "operator"],

        // Numbers
        [/\b\d+(\.\d+)?\b/, "number"],

        // ObjectId
        [/ObjectId\("([0-9a-fA-F]{24})"\)/, "type"],

        // Brackets and punctuation
        [/[{}()\[\]]/, "@brackets"],
        [/[;,]/, "delimiter"],

        // Identifiers
        [/[a-zA-Z_]\w*/, "identifier"],
      ],

      comment: [
        [/[^*/]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/./, "comment"],
      ],

      string: [
        [/[^']+/, "string"],
        [/''/, "string"],
        [/'/, "string", "@pop"],
      ],

      string_double: [
        [/[^"]+/, "string"],
        [/""/, "string"],
        [/"/, "string", "@pop"],
      ],
    },
  });

  // Function to create suggestions dynamically based on metadata
  const createSuggestions = (metadata: any) => {
    const suggestions: any = [];
    try {
      // Add collection names
      const { collections } = metadata;
      if (collections) {
        collections.forEach((collection: any) => {
          // Collection suggestions
          suggestions.push({
            label: `db.${collection.table_name}`,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: `db.${collection.table_name}`,
            detail: `Collection: ${collection.table_name}`,
            documentation: `MongoDB collection: ${collection.table_name}`,
          });
        });
      }

      // Add comprehensive MongoDB commands and methods
      const mongoCommands = [
        // CRUD Operations
        { label: "find", snippet: "find(${1:{}})" },
        { label: "findOne", snippet: "findOne(${1:{}})" },
        { label: "insertOne", snippet: "insertOne(${1:{}})" },
        {
          label: "insertMany",
          snippet: "insertMany([${1:document1}, ${2:document2}])",
        },
        {
          label: "updateOne",
          snippet:
            "updateOne(${1:filter}, { \\$set: { ${2:field}: ${3:value} } })",
        },
        {
          label: "updateMany",
          snippet:
            "updateMany(${1:filter}, { \\$set: { ${2:field}: ${3:value} } })",
        },
        { label: "deleteOne", snippet: "deleteOne(${1:{}})" },
        { label: "deleteMany", snippet: "deleteMany(${1:{}})" },
        {
          label: "replaceOne",
          snippet: "replaceOne(${1:filter}, ${2:replacement})",
        },

        // Aggregation Pipeline
        {
          label: "aggregate",
          snippet:
            "aggregate([\n  { \\$match: { ${1:field}: ${2:value} } },\n  { \\$group: { _id: \\$${3:groupField}, count: { \\$sum: 1 } } },\n  { \\$sort: { count: -1 } }\n])",
        },
        {
          label: "$match",
          snippet: "{ \\$match: { ${1:field}: ${2:value} } }",
        },
        {
          label: "$group",
          snippet:
            "{ \\$group: { _id: \\$${1:groupField}, ${2:field}: { \\$sum: \\$${3:sumField} } } }",
        },
        { label: "$sort", snippet: "{ \\$sort: { ${1:field}: ${2:1|-1} } }" },
        { label: "$limit", snippet: "{ \\$limit: ${1:10} }" },
        { label: "$skip", snippet: "{ \\$skip: ${1:0} }" },
        {
          label: "$project",
          snippet: "{ \\$project: { ${1:field}: 1, ${2:field}: 0 } }",
        },
        { label: "$unwind", snippet: "{ \\$unwind: \\$${1:arrayField} }" },
        {
          label: "$lookup",
          snippet:
            '{ \\$lookup: { from: "${1:collection}", localField: "${2:localField}", foreignField: "${3:foreignField}", as: "${4:outputField}" } }',
        },
        {
          label: "$addFields",
          snippet:
            '{ \\$addFields: { ${1:newField}: { \\$add: ["\\$${2:field1}", "\\$${3:field2}" ] } } }',
        },
        { label: "$set", snippet: "{ \\$set: { ${1:field}: ${2:value} } }" },
        { label: "$unset", snippet: '{ \\$unset: { ${1:field}: "" } }' },

        // Query Operators
        {
          label: "$and",
          snippet: "{ \\$and: [{ ${1:condition1} }, { ${2:condition2} }] }",
        },
        {
          label: "$or",
          snippet: "{ \\$or: [{ ${1:condition1} }, { ${2:condition2} }] }",
        },
        {
          label: "$in",
          snippet: "{ ${1:field}: { \\$in: [${2:value1}, ${3:value2}] } }",
        },
        {
          label: "$nin",
          snippet: "{ ${1:field}: { \\$nin: [${2:value1}, ${3:value2}] } }",
        },
        { label: "$gt", snippet: "{ ${1:field}: { \\$gt: ${2:value} } }" },
        { label: "$gte", snippet: "{ ${1:field}: { \\$gte: ${2:value} } }" },
        { label: "$lt", snippet: "{ ${1:field}: { \\$lt: ${2:value} } }" },
        { label: "$lte", snippet: "{ ${1:field}: { \\$lte: ${2:value} } }" },
        { label: "$ne", snippet: "{ ${1:field}: { \\$ne: ${2:value} } }" },
        {
          label: "$regex",
          snippet:
            '{ ${1:field}: { \\$regex: "${2:pattern}", \\$options: "${3:i}" } }',
        },
        {
          label: "$exists",
          snippet: "{ ${1:field}: { \\$exists: ${2:true|false} } }",
        },
        {
          label: "$type",
          snippet:
            '{ ${1:field}: { \\$type: "${2:string|number|boolean|date|object|array}" } }',
        },

        // Aggregation Operators
        { label: "$sum", snippet: "{ \\$sum: \\$${1:field} }" },
        { label: "$avg", snippet: "{ \\$avg: \\$${1:field} }" },
        { label: "$min", snippet: "{ \\$min: \\$${1:field} }" },
        { label: "$max", snippet: "{ \\$max: \\$${1:field} }" },
        { label: "$count", snippet: '{ \\$count: "${1:fieldName}" }' },
        { label: "$push", snippet: "{ \\$push: \\$${1:field} }" },
        { label: "$addToSet", snippet: "{ \\$addToSet: \\$${1:field} }" },
        { label: "$first", snippet: "{ \\$first: \\$${1:field} }" },
        { label: "$last", snippet: "{ \\$last: \\$${1:field} }" },

        // Array Operators
        { label: "$size", snippet: "{ ${1:field}: { \\$size: ${2:number} } }" },
        {
          label: "$all",
          snippet: "{ ${1:field}: { \\$all: [${2:value1}, ${3:value2}] } }",
        },
        {
          label: "$elemMatch",
          snippet: "{ ${1:field}: { \\$elemMatch: { ${2:condition} } } }",
        },

        // String Operators
        {
          label: "$concat",
          snippet: '{ \\$concat: ["\\$${1:field1}", "\\$${2:field2}" ] }',
        },
        { label: "$toUpper", snippet: "{ \\$toUpper: \\$${1:field} }" },
        { label: "$toLower", snippet: "{ \\$toLower: \\$${1:field} }" },
        {
          label: "$substr",
          snippet: '{ \\$substr: ["\\$${1:field}", ${2:start}, ${3:length}] }',
        },

        // Date Operators
        {
          label: "$dateToString",
          snippet:
            '{ \\$dateToString: { format: "${1:%Y-%m-%d}", date: \\$${2:dateField} } }',
        },
        { label: "$year", snippet: "{ \\$year: \\$${1:dateField} }" },
        { label: "$month", snippet: "{ \\$month: \\$${1:dateField} }" },
        {
          label: "$dayOfMonth",
          snippet: "{ \\$dayOfMonth: \\$${1:dateField} }",
        },
        { label: "$hour", snippet: "{ \\$hour: \\$${1:dateField} }" },
        { label: "$minute", snippet: "{ \\$minute: \\$${1:dateField} }" },
        { label: "$second", snippet: "{ \\$second: \\$${1:dateField} }" },

        // Math Operators
        {
          label: "$add",
          snippet: '{ \\$add: ["\\$${1:field1}", "\\$${2:field2}" ] }',
        },
        {
          label: "$subtract",
          snippet: '{ \\$subtract: ["\\$${1:field1}", "\\$${2:field2}" ] }',
        },
        {
          label: "$multiply",
          snippet: '{ \\$multiply: ["\\$${1:field1}", "\\$${2:field2}" ] }',
        },
        {
          label: "$divide",
          snippet: '{ \\$divide: ["\\$${1:field1}", "\\$${2:field2}" ] }',
        },
        {
          label: "$mod",
          snippet: '{ \\$mod: ["\\$${1:field1}", "\\$${2:field2}" ] }',
        },
        {
          label: "$round",
          snippet: '{ \\$round: ["\\$${1:field}", ${2:decimals}] }',
        },
        { label: "$ceil", snippet: "{ \\$ceil: \\$${1:field} }" },
        { label: "$floor", snippet: "{ \\$floor: \\$${1:field} }" },
        { label: "$abs", snippet: "{ \\$abs: \\$${1:field} }" },
        { label: "$sqrt", snippet: "{ \\$sqrt: \\$${1:field} }" },
        {
          label: "$pow",
          snippet: '{ \\$pow: ["\\$${1:field}", ${2:exponent}] }',
        },

        // Conditional Operators
        {
          label: "$cond",
          snippet:
            "{ \\$cond: { if: { ${1:condition} }, then: ${2:trueValue}, else: ${3:falseValue} } }",
        },
        {
          label: "$ifNull",
          snippet: '{ \\$ifNull: ["\\$${1:field}", ${2:defaultValue}] }',
        },
        {
          label: "$switch",
          snippet:
            "{ \\$switch: { branches: [{ case: { ${1:condition} }, then: ${2:value} }], default: ${3:defaultValue} } }",
        },

        // Utility Commands
        {
          label: "distinct",
          snippet: 'distinct("${1:field}"${2:, { filter: {} }})',
        },
        { label: "countDocuments", snippet: "countDocuments({ ${1:filter} })" },
        {
          label: "estimatedDocumentCount",
          snippet: "estimatedDocumentCount()",
        },
        {
          label: "createIndex",
          snippet: "createIndex({ ${1:field}: ${2:1|-1} })",
        },
        { label: "dropIndex", snippet: 'dropIndex("${1:indexName}" )' },
        { label: "getIndexes", snippet: "getIndexes()" },
        { label: "listIndexes", snippet: "listIndexes()" },

        // Common Patterns
        {
          label: "Find with filter",
          snippet: "find({ ${1:field}: { \\$eq: ${2:value} } })",
        },
        {
          label: "Find with multiple conditions",
          snippet:
            "find({ \\$and: [{ ${1:field1}: ${2:value1} }, { ${3:field2}: ${4:value2} }] })",
        },
        {
          label: "Find with regex",
          snippet:
            'find({ ${1:field}: { \\$regex: "${2:pattern}", \\$options: "${3:i}" } })',
        },
        {
          label: "Find with date range",
          snippet:
            'find({ ${1:dateField}: { \\$gte: ISODate("${2:startDate}" ), \\$lte: ISODate("${3:endDate}" ) } })',
        },
        {
          label: "Aggregate with lookup",
          snippet:
            'aggregate([\n  { \\$lookup: { from: "${1:collection}", localField: "${2:localField}", foreignField: "${3:foreignField}", as: "${4:outputField}" } },\n  { \\$match: { ${5:condition} } },\n  { \\$project: { ${6:field}: 1 } }\n])',
        },
        {
          label: "Group by field",
          snippet:
            "aggregate([\n  { \\$group: { _id: \\$${1:groupField}, count: { \\$sum: 1 }, total: { \\$sum: \\$${2:sumField} } } },\n  { \\$sort: { count: -1 } }\n])",
        },
      ];

      mongoCommands.forEach((command) => {
        suggestions.push({
          label: command.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: command.snippet,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: `MongoDB: ${command.label}`,
          documentation: `Insert ${command.label} with placeholders`,
        });
      });

      // Add data type suggestions (only unique ones)
      const uniqueTypes = typeKeywords.filter(
        (type, index, self) => self.indexOf(type) === index,
      );
      uniqueTypes.forEach((type) => {
        suggestions.push({
          label: type,
          kind: monaco.languages.CompletionItemKind.TypeParameter,
          insertText: type,
          detail: `Data Type: ${type}`,
          documentation: `MongoDB data type: ${type}`,
        });
      });

      // Add operator suggestions (only unique ones)
      const uniqueOperators = operators.filter(
        (op, index, self) => self.indexOf(op) === index,
      );
      uniqueOperators.forEach((op) => {
        suggestions.push({
          label: op,
          kind: monaco.languages.CompletionItemKind.Operator,
          insertText: op,
          detail: `Operator: ${op}`,
          documentation: `MongoDB operator: ${op}`,
        });
      });

      // Add basic keyword suggestions (only for keywords not covered by snippets)
      const snippetLabels = mongoCommands.map((cmd) => cmd.label);
      const basicKeywords = keywords.filter(
        (keyword) => !snippetLabels.includes(keyword),
      );

      basicKeywords.forEach((keyword) => {
        suggestions.push({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          detail: `Keyword: ${keyword}`,
          documentation: `MongoDB keyword: ${keyword}`,
        });
      });
    } catch (error) {
      console.error("Error creating MongoDB suggestions:", error);
    } finally {
      return suggestions;
    }
  };

  // Register completion item provider
  monaco.languages.registerCompletionItemProvider("mongodb", {
    provideCompletionItems: () => {
      // Generate suggestions dynamically
      const suggestions = createSuggestions(databaseMetadata);
      return { suggestions };
    },
  });

  // Register hover provider for better documentation
  monaco.languages.registerHoverProvider("mongodb", {
    provideHover: (model: any, position: any) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const wordText = word.word.toUpperCase();

      // Check if it's a keyword
      if (keywords.includes(wordText)) {
        return {
          contents: [
            { value: `**${wordText}**` },
            { value: `MongoDB keyword` },
          ],
        };
      }

      // Check if it's a data type
      if (typeKeywords.includes(wordText)) {
        return {
          contents: [
            { value: `**${wordText}**` },
            { value: `MongoDB data type` },
          ],
        };
      }

      return null;
    },
  });
};

export const mongoJsonLanguageServer = async(monaco: any) => {
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
                monaco.languages.CompletionItemInsertTextRule
                  .InsertAsSnippet,
              documentation: "Create a MongoDB ObjectId",
              detail: "MongoDB ObjectId constructor",
            },
            {
              label: "ISODate",
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'ISODate("${1:date}")',
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule
                  .InsertAsSnippet,
              documentation: "Create a MongoDB ISODate",
              detail: "MongoDB ISODate constructor",
            },
            {
              label: "NumberInt",
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: "NumberInt(${1:value})",
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule
                  .InsertAsSnippet,
              documentation: "Create a MongoDB NumberInt",
              detail: "MongoDB NumberInt constructor",
            },
            {
              label: "NumberLong",
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: "NumberLong(${1:value})",
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule
                  .InsertAsSnippet,
              documentation: "Create a MongoDB NumberLong",
              detail: "MongoDB NumberLong constructor",
            },
            {
              label: "NumberDouble",
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: "NumberDouble(${1:value})",
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule
                  .InsertAsSnippet,
              documentation: "Create a MongoDB NumberDouble",
              detail: "MongoDB NumberDouble constructor",
            },
            {
              label: "NumberDecimal",
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: 'NumberDecimal("${1:value}")',
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule
                  .InsertAsSnippet,
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
