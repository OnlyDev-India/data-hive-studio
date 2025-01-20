import { NewTableInitialStateType } from "@/types/file.type";

export const initialFormData: Record<string, NewTableInitialStateType> = {
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
