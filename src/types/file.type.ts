interface FileType {
  id: string;
  name: string;
  type: "file" | "table" | "structure" | "newTable";
  code?: string;
  tableName?: string;
  tableData?: any;
}
