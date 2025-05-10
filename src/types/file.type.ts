import { SortColumn } from "react-data-grid";
import { Row, TableFormColumn } from "./table.type";

export type FileType =
  | FileFileType
  | FileTableType
  | FileStructureType
  | FileNewTableType;

export interface FileFileType {
  id: string;
  name: string;
  type: "file";
  code?: string;
}

export interface FileTableType {
  id: string;
  name: string;
  type: "table";
  tableName: string;
  tableData: { columns: any; rows: any; totalRecords: number };
  tableFilter: {
    filter: {
      oldFilter: any;
      newFilter: any;
    };
    applyFilter: boolean;
    filterOpened: boolean;
  };
  tableOrder: SortColumn[];
  tablePagination: PaginationType;
  tableRefetch?: RefetchType;
  tableOperations?: {
    selectedRows: number[];
    changedRows: { [key: number]: { old: Row; new: Row } };
    insertedRows: number;
  };
}

export interface FileStructureType {
  id: string;
  name: string;
  type: "structure";
  tableName: string;
  tableData?: {
    columns: any;
    relations: any;
  };
}

export interface FileNewTableType {
  id: string;
  name: string;
  type: "newTable";
  tableName: string;
  tableForm?: NewTableInitialStateType;
}

export interface NewTableInitialStateType {
  name: string;
  columns?: TableFormColumn[];
}

export interface PaginationType {
  page: number;
  limit: number;
}

export type RefetchType =
  | "fetch"
  | "filter"
  | "sort:asc"
  | "sort:desc"
  | "sort:undefined"
  | "pagination:prev"
  | "pagination:next"
  | "pagination:limit"
  | "pagination:page"
  | null;
