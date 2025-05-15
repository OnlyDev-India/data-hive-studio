import { Column } from "react-data-grid";

export const columns: Column<any>[] = [
  {
    key: "column_name",
    name: "Name",
  },
  {
    key: "data_type",
    name: "Type",
  },
  {
    key: "key_type",
    name: "Key Type",
  },
  {
    key: "column_default",
    name: "Default Value",
  },
];

export const relationColumns: Column<any>[] = [
  {
    key: "column_name",
    name: "Column Name",
  },
  {
    key: "referenced_table_name",
    name: "Foreign Table Name",
  },
  {
    key: "referenced_column_name",
    name: "Foreign Column Name",
  },
  {
    key: "onDelete",
    name: "On Delete",
  },
  {
    key: "onUpdate",
    name: "On Update",
  },
];
