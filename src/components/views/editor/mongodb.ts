export const mongodbLanguageServer = (monaco: any, databaseMetadata: any) => {
  monaco.languages.register({ id: "mongodb" });

  monaco.languages.setMonarchTokensProvider("mongodb", {
    tokenizer: {
      root: [
        [/(db\.\w+)/, "variable"],
        [
          /\b(find|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|aggregate)\b/,
          "keyword",
        ],
        [/\b(ObjectId|ISODate|NumberInt|NumberLong|NumberDecimal)\b/, "type"],
        [/".*?"/, "string"],
        [/\/\/.*/, "comment"],
        [/\b(true|false|null)\b/, "constant"],
      ],
    },
  });
  const { collections }: any = databaseMetadata;
  if (!collections) return;
  monaco.languages.registerCompletionItemProvider("mongodb", {
    provideCompletionItems: function () {
      return {
        suggestions: [
          ...collections.map((col: any) => ({
            label: `db.${col.table_name}`,
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: `db.${col.table_name}.find({})`,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          })),
          {
            label: "find",
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: "find(${1:{}})",
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          },
          {
            label: "insertOne",
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: "insertOne(${1:{}})",
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          },
        ],
      };
    },
  });
};
