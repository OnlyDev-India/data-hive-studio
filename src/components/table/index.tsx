"use client";

import { useMemo, useState } from "react";
import ReactDataGrid, { Column, SortColumn } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import "@/styles/table.css";
import Filter from "./filter";
import { Button } from "../ui/button";
import { RefreshCcwIcon } from "lucide-react";
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
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]);
  const [filterValue, setFilterValue] = useState<{
    column: ColumnProps | null;
    value: any;
    compare: any;
  }>({ column: null, value: "", compare: null });

  const comparator = (a: Row, b: Row): number => {
    for (const sort of sortColumns) {
      const { columnKey, direction } = sort;
      const aValue = a[columnKey];
      const bValue = b[columnKey];

      if (typeof aValue === "boolean" && typeof bValue === "boolean") {
        return aValue === bValue ? 0 : aValue ? 1 : -1; // Sort booleans
      }
      if (typeof aValue === "number" && typeof bValue === "number") {
        return direction === "ASC" ? aValue - bValue : bValue - aValue; // Sort numbers
      }
      if (typeof aValue === "string" && typeof bValue === "string") {
        return direction === "ASC"
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue); // Sort strings
      }
      if (aValue instanceof Date && bValue instanceof Date) {
        return direction === "ASC"
          ? aValue.getTime() - bValue.getTime()
          : bValue.getTime() - aValue.getTime(); // Sort dates
      }
    }
    return 0; // Equal values
  };

  const updatedColumns: Column<any>[] = useMemo(() => {
    return columns.map((column) => {
      const data_type = column.data_type;

      return {
        ...column,
        width: 200,
        resizable: true,
        sortable: true,
        renderHeaderCell: ({ column }: any) => (
          <div className="w-full h-full cursor-pointer flex items-center justify-between">
            <p className="flex gap-2">
              {column.key_type === "PRIMARY KEY" && <span>🔑</span>}
              {column.key_type === "FOREIGN KEY" && <span>🔗</span>}
              <span>{column.name}</span>
              <span className="text-muted-foreground bg-background p-0.5 px-4 rounded-md text-xs max-w-[100px] truncate">
                {data_type}
              </span>
            </p>
            <span>
              {sortColumns[0]?.columnKey === column.key &&
                (sortColumns[0]?.direction === "ASC" ? " 🔼" : " 🔽")}
            </span>
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
  }, [columns, sortColumns]);

  const sortedData = useMemo((): readonly Row[] => {
    if (sortColumns.length === 0) return data;

    return [...data].sort((a, b) => {
      const compResult = comparator(a, b);
      if (compResult !== 0) {
        return compResult;
      }
      return 0;
    });
  }, [data, sortColumns]);

  const filterComparator = (a: any, b: any, compare: string): boolean => {
    switch (compare) {
      case "equals":
        if (typeof a === "string" && typeof b === "string") {
          return (
            a.toLowerCase().includes(b.toLowerCase()) ||
            b.toLowerCase().includes(a.toLowerCase())
          ); // Return true if either includes the other
        }
        return a === b;
      case "not equals":
        if (typeof a === "string" && typeof b === "string") {
          return !(
            a.toLowerCase().includes(b.toLowerCase()) ||
            b.toLowerCase().includes(a.toLowerCase())
          ); // Return true if either includes the other
        }
        return a !== b;
      case "greater than":
        return a > b;
      case "less than":
        return a < b;
      case "greater than or equal":
        return a >= b;
      case "less than or equal":
        return a <= b;
      default:
        return true; // If no valid compare, return all
    }
  };

  const filterData = useMemo(() => {
    const filterColumn = filterValue.column;
    const filterValueValue = filterValue.value;
    const filterCompare = filterValue.compare;
    if (!filterColumn || !filterCompare || filterValueValue === "")
      return sortedData;

    // based on filterCompare compare values from sortedData and // Implement filtering based on the selected compare
    return sortedData.filter((row) => {
      const value = row[filterColumn.key];
      return filterComparator(value, filterValueValue, filterCompare);
    });
  }, [sortedData, filterValue]);

  return (
    <div
      className={cn("h-[calc(100vh-3rem)] px-2", {
        "h-[calc(100%-2.3rem)]": isSmall,
      })}
    >
      {!columns || columns?.length === 0 ? (
        <div className="h-full flex items-center justify-center">
          <p className="text-muted-foreground">No data found</p>
        </div>
      ) : (
        <>
          <div className="h-10 flex items-center gap-2">
            {refetchData && (
              <Button variant={"secondary"} size={"icon"} onClick={refetchData}>
                <RefreshCcwIcon />
              </Button>
            )}
            <Filter columns={columns} setFilter={setFilterValue} />
          </div>
          <div
            className={cn("h-[calc(100vh-5.5rem)]", {
              "h-[calc(100%-2.3rem)]": isSmall,
            })}
          >
            <ReactDataGrid
              columns={updatedColumns} // Dynamically set columns
              rows={filterData} // Dynamically set rows
              rowHeight={40} // Row height
              headerRowHeight={50} // Header row height
              sortColumns={sortColumns}
              onSortColumnsChange={setSortColumns}
              // onRowsChange={(newRows) => } // Handling row changes
              className="fill-grid h-full bg-background react-data-grid"
            />
          </div>
        </>
      )}
    </div>
  );
};

export default Table;
