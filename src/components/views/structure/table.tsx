"use client";

import { useMemo } from "react";
import ReactDataGrid, { Column } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import "@/styles/table.css";

import { cn } from "@/lib/utils";

// Define the structure of the data (you can update this based on your actual data)
interface ColumnProps extends Column<any> {
  data_type?: string;
}

interface Row {
  [key: string]: any; // Dynamic data rows
}

interface TableProps {
  columns: ColumnProps[];
  data: Row[];
  refetchData?: () => void;
  isSmall?: boolean;
}

const Table = ({ columns, data, refetchData, isSmall }: TableProps) => {
  // React Data Grid requires columns and rows
  // const [gridRows, setGridRows] = useState<Row[]>([]);

  const updatedColumns: Column<any>[] = useMemo(() => {
    return columns.map((column) => {
      return {
        ...column,
        width: 200,
        resizable: true,
        renderHeaderCell: ({ column }: any) => (
          <div className="w-full h-full cursor-pointer flex items-center justify-between">
            <p className="flex gap-2">
              <span>{column.name}</span>
            </p>
          </div>
        ),
        renderCell: ({ row }: any) => {
          return (
            <span
              className={cn("w-full pl-2 truncate", {
                "text-muted-foreground": !row[column.key],
              })}
            >
              {!row[column.key] ? "null" : row[column.key]?.toString()}
            </span>
          );
        },
      };
    });
  }, [columns]);

  return !columns || columns?.length === 0 ? (
    <div className="h-full flex items-center justify-center">
      <p className="text-muted-foreground">No data found</p>
    </div>
  ) : (
    <div className={cn("h-full")}>
      <ReactDataGrid
        columns={updatedColumns} // Dynamically set columns
        rows={data} // Dynamically set rows
        rowHeight={40} // Row height
        headerRowHeight={50} // Header row height
        // onRowsChange={(newRows) => } // Handling row changes
        className="fill-grid h-full bg-background react-data-grid"
      />
    </div>
  );
};

export default Table;
