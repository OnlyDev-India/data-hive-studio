import { pgSqlTypes } from "@/types/db.type";

export const initialFormData = {
  pgSql: {
    name: "untitled",
    columns: [
      {
        name: "id",
        type: "UUID",
        isNull: false,
        defaultValue: "gen_random_uuid()",
        keyType: "PRIMARY",
        foreignTable: "",
        foreignTableColumn: "",
      },
    ],
  },
};
