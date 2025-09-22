import { SortColumn } from "react-data-grid";
import { Row, TableFormColumn } from "./table.type";
import { Viewport } from "@xyflow/react";

export type FileType =
  | FileFileType
  | FileTableType
  | FileStructureType
  | FileNewTableType
  | VisualizerFileType;

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
    selectedRows: string[];
    changedRows: { [key: string]: { old: Row; new: Row } };
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
  tableForm?: NewTableInitialStateType;
}

export interface NewTableInitialStateType {
  name: string;
  columns?: TableFormColumn[];
}

export interface VisualizerFileType {
  id: string;
  name: string;
  type: "visualizer";
  
  visualizerData?: {
    tables: any[];
    selectedTables?: any[];
    viewport?: Viewport;
  };
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
