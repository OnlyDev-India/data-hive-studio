import { Row } from "./table.type";

export interface FileType {
  id: string;
  name: string;
  type: "file" | "table" | "structure" | "newTable";
  code?: string;
  tableName?: string;
  tableData?: any;
  tableFilter?: {
    filter: {
      oldFilter: any;
      newFilter: any;
    };
    applyFilter: boolean;
    filterOpened: boolean;
  };
  tableOperations?: {
    selectedRows: number[];
    changedRows: { [key: number]: { old: Row; new: Row } };
    insertedRows: number;
  };
}
