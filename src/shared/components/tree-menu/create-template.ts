import type { SchemaObjectKind } from "@/shared/api";

export type TemplateKind =
  Exclude<SchemaObjectKind, "table"> | "extension" | "role" | "search_path";

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** The starter SQL a "New …" item seeds into a fresh SQL tab. */
export function createTemplate(
  kind: TemplateKind,
  schema: string | undefined,
  dialect: "pg" | "sqlite",
): string {
  if (dialect === "sqlite") return "CREATE VIEW new_view AS\nSELECT\n  1;";
  const s = quote(schema ?? "public");
  switch (kind) {
    case "view":
      return `CREATE VIEW ${s}.new_view AS\nSELECT\n  1;`;
    case "materialized_view":
      return `CREATE MATERIALIZED VIEW ${s}.new_view AS\nSELECT\n  1\nWITH DATA;`;
    case "function":
      return `CREATE FUNCTION ${s}.new_function()\nRETURNS integer\nLANGUAGE sql\nAS $$\n  SELECT 1;\n$$;`;
    case "procedure":
      return `CREATE PROCEDURE ${s}.new_procedure()\nLANGUAGE plpgsql\nAS $$\nBEGIN\nEND;\n$$;`;
    case "sequence":
      return `CREATE SEQUENCE ${s}.new_sequence\n  START WITH 1\n  INCREMENT BY 1;`;
    case "type":
      return `CREATE TYPE ${s}.new_type AS ENUM ('a', 'b');`;
    case "extension":
      return "CREATE EXTENSION IF NOT EXISTS extension_name;";
    case "role":
      return "CREATE ROLE role_name WITH LOGIN PASSWORD 'change_me';";
    case "search_path":
      return `SET search_path TO ${s};\n\n`;
  }
}
