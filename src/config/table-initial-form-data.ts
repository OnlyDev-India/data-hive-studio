import { pgSqlTypes } from "@/types/db.type";

export const initialFormData = {
  pgSql: {
    name: "untitled",
    columns: [
      {
        name: "id",
        type: "UUID",
        isNull: false,
        defaultValue: "",
        keyType: "PRIMARY",
        foreignTable: "",
        foreignTableColumn: "",
      },
    ],
  },
};
