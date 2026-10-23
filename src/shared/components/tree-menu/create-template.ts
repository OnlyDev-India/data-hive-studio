import type { SchemaObjectKind } from "@/shared/api";

export type TemplateKind =
  Exclude<SchemaObjectKind, "table"> | "extension" | "role" | "search_path";

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** MySQL starters (spec 0025). A body with its own `;` sits between
 *  `DELIMITER ;;` lines so the script splitter sends it whole. */
function mysqlTemplate(kind: TemplateKind): string {
  switch (kind) {
    case "view":
      return "CREATE VIEW new_view AS\nSELECT\n  1;";
    case "function":
      return "CREATE FUNCTION new_function()\nRETURNS INT\nDETERMINISTIC\nRETURN 1;";
    case "procedure":
      return "DELIMITER ;;\nCREATE PROCEDURE new_procedure()\nBEGIN\n  SELECT 1;\nEND;;\nDELIMITER ;";
    case "trigger":
      return "CREATE TRIGGER new_trigger\nBEFORE INSERT ON table_name\nFOR EACH ROW\nSET NEW.column_name = NEW.column_name;";
    case "event":
      return "CREATE EVENT new_event\nON SCHEDULE EVERY 1 DAY\nDO\n  SELECT 1;";
    case "role":
      return "CREATE USER 'user_name'@'%' IDENTIFIED BY 'change_me';";
    default:
      return "";
  }
}

/** The starter SQL a "New …" item seeds into a fresh SQL tab. */
export function createTemplate(
  kind: TemplateKind,
  schema: string | undefined,
  dialect: "pg" | "sqlite" | "mysql",
): string {
  if (dialect === "sqlite") return "CREATE VIEW new_view AS\nSELECT\n  1;";
  if (dialect === "mysql") return mysqlTemplate(kind);
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
    // Postgres lists triggers per table and has no events.
    case "trigger":
    case "event":
      return "";
  }
}
