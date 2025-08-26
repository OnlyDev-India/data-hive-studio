import { Column, RenderCellProps } from "react-data-grid";

export interface TableForm {
  name: string;
  columns?: TableFormColumn[];
}

export interface TableFormColumn {
  name: string;
  type: string;
  isNull: boolean;
  defaultValue: any;
  keyType: "PRIMARY" | "FOREIGN KEY";
  foreignTable: string;
  foreignTableColumn: string;
}

export interface CustomColumns extends Column<any> {
  customRenderCell?: (
    props: RenderCellProps<any>,
    extraFiled: any,
  ) => React.ReactNode;
}

export interface Row {
  [key: string]: any; // Dynamic data rows
}

export interface FilterType {
  column: string;
  compare: string;
  separator: string;
  value: any;
  value2?: any; // For between, range operations
  isCustomQuery?: boolean; // Flag to indicate if this is a custom SQL query
  customQuery?: string; // Custom SQL query text
  sortBy?: string; // MongoDB sort object for custom sorting
}
