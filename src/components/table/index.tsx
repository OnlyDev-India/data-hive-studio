"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactDataGrid, {
  Column,
  RenderCellProps,
  SortColumn,
} from "react-data-grid";
import "react-data-grid/lib/styles.css";
import Filter from "./filter";
import { Button } from "../ui/button";
import { ListFilterIcon, LoaderCircleIcon, RefreshCcwIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import ForeignKeyCells from "../table-cells/foreign-key-cells";
import { Checkbox } from "../ui/checkbox";
import SelectCell from "../table-cells/select-cell";
import InputCell from "../table-cells/input-cell";
import FloatingActions from "./floating-action";
import { useDispatch, useSelector } from "react-redux";
import { updateFile } from "@/redux/features/open-files";

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
  isFetching?: boolean;
}

const Table = ({
  columns,
  data,
  refetchData,
  isSmall,
  isFetching,
}: TableProps) => {
  // React Data Grid requires columns and rows
  const [gridRows, setGridRows] = useState<Row[]>([]);
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]);
  const [changedRows, setChangedRows] = useState<{
    [key: number]: { old: Row; new: Row };
  }>({});
  const [selectedRows, setSelectedRows] = useState<number[]>([]);

  const [isFilter, setIsFilter] = useState<boolean>(false);
  const [filterDivHeight, setFilterDivHeight] = useState<number>(56);

  const { currentFile } = useSelector((state: any) => state.openFiles);
  const dispatch = useDispatch();

  const filterRef = useRef<HTMLDivElement>(null);

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
    const newColumns = columns.map((column) => {
      const data_type = column.data_type;

      return {
        ...column,
        width: 200,
        resizable: true,
        sortable: true,
        cellClass:
          "text-xs md:text-sm flex items-center text-foreground aria-[selected='true']:outline-primary aria-[selected='true']:rounded-md border",
        headerCellClass:
          "bg-muted text-muted-foreground aria-[selected='true']:outline-primary aria-[selected='true']:rounded-md border",
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
        renderCell: (props: any) => {
          const { row, column } = props;
          if (column.key_type === "FOREIGN KEY") {
            return <ForeignKeyCells {...props} disabled={false} />;
          }
          if (column.data_type === "boolean") {
            return (
              <SelectCell
                name={column.key}
                className="px-3"
                {...props}
                items={[
                  { label: "true", value: true },
                  { label: "false", value: false },
                ]}
              />
            );
          }
          // console.log(isValidDate(props.row.createdAt));

          return (
            <InputCell
              name={column.key}
              {...props}
              className="px-3 !border-0"
            />
          );
        },
      };
    });

    const checkBoxColumn: Column<any> = {
      key: "checkbox",
      name: "CheckBox",
      width: 30,
      frozen: true,
      cellClass:
        "!bg-background hover:!bg-background !rounded-none aria-[selected='true']:outline-none border",
      headerCellClass:
        "bg-muted text-muted-foreground aria-[selected='true']:outline-none border",
      renderHeaderCell: ({ column }: any) => {
        const isChecked =
          selectedRows.length === gridRows.length && gridRows.length > 0;
        const handleCheckedChanges = (checked: boolean) => {
          if (checked) {
            setSelectedRows(gridRows.map((_, index) => index));
          } else {
            setSelectedRows([]);
          }
        };
        return (
          <div className="w-full group flex items-center justify-center">
            <Checkbox
              checked={isChecked}
              className={cn("invisible group-hover:visible", {
                visible: selectedRows.length > 0,
              })}
              onCheckedChange={handleCheckedChanges}
            />
          </div>
        );
      },
      renderCell: ({ rowIdx }: RenderCellProps<any>) => {
        const handleCheckedChanges = (checked: boolean) => {
          const selectedRowsSet = new Set(selectedRows);
          const selectedRowsArray = Array.from(selectedRowsSet);
          if (checked) {
            selectedRowsArray.push(rowIdx);
            setSelectedRows(selectedRowsArray);
          } else {
            selectedRowsArray.splice(selectedRowsArray.indexOf(rowIdx), 1);
            setSelectedRows(selectedRowsArray);
          }
        };
        return (
          <div className="w-full group flex items-center justify-center">
            <Checkbox
              checked={selectedRows.includes(rowIdx)}
              onCheckedChange={handleCheckedChanges}
              className={cn("hidden group-hover:inline-block", {
                "inline-block": selectedRows.length > 0,
              })}
            />
            <p
              className={cn("group-hover:hidden inline-block", {
                hidden: selectedRows.length > 0,
              })}
            >
              {rowIdx + 1}
            </p>
          </div>
        );
      },
    };

    return [checkBoxColumn, ...newColumns];
  }, [columns, sortColumns, selectedRows]);

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

  // const filterComparator = (a: any, b: any, compare: string): boolean => {
  //   switch (compare) {
  //     case "equals":
  //       if (typeof a === "string" && typeof b === "string") {
  //         return (
  //           a.toLowerCase().includes(b.toLowerCase()) ||
  //           b.toLowerCase().includes(a.toLowerCase())
  //         ); // Return true if either includes the other
  //       }
  //       return a === b;
  //     case "not equals":
  //       if (typeof a === "string" && typeof b === "string") {
  //         return !(
  //           a.toLowerCase().includes(b.toLowerCase()) ||
  //           b.toLowerCase().includes(a.toLowerCase())
  //         ); // Return true if either includes the other
  //       }
  //       return a !== b;
  //     case "greater than":
  //       return a > b;
  //     case "less than":
  //       return a < b;
  //     case "greater than or equal":
  //       return a >= b;
  //     case "less than or equal":
  //       return a <= b;
  //     default:
  //       return true; // If no valid compare, return all
  //   }
  // };

  const handleRowChange = (rows: Row[], changesRows: any) => {
    const rowIndexes = changesRows.indexes;
    const newRow = rows[rowIndexes[0]];
    // console.log({ ...changedRows, [rowIndexes[0]]: row });
    const oldRow = gridRows[rowIndexes[0]];
    let changedData = { ...changedRows };
    if (changedData[rowIndexes[0]]?.old) {
      changedData[rowIndexes[0]] = {
        old: changedData[rowIndexes[0]].old,
        new: newRow,
      };
    } else {
      changedData[rowIndexes[0]] = {
        old: oldRow,
        new: newRow,
      };
    }

    if (
      JSON.stringify(changedData[rowIndexes[0]].old) ===
      JSON.stringify(changedData[rowIndexes[0]].new)
    ) {
      delete changedData[rowIndexes[0]];
    }

    // console.log(changedData);

    setChangedRows(changedData);
    setGridRows(rows);
  };

  const handleUpdateChanges = (type: string) => {
    switch (type) {
      case "update":
        setChangedRows([]);
        return;
      case "delete":
        setSelectedRows([]);
        return;
      default:
        setChangedRows([]);
        setSelectedRows([]);
        setGridRows(data);
        return;
    }
  };

  useEffect(() => {
    setGridRows(sortedData as any);
  }, [sortedData]);

  useEffect(() => {
    if (currentFile?.tableFilter) {
      setIsFilter(true);
    }
  }, [currentFile?.tableFilter]);

  const updateDivHeight = () => {
    if (filterRef.current) {
      setFilterDivHeight(filterRef.current.offsetHeight || 0);
    }
  };

  useEffect(() => {
    updateDivHeight();
    // console.log(currentFile?.tableName, currentFile?.tableFilter);

    if (
      currentFile?.tableName &&
      currentFile?.tableFilter?.filter?.length === 0
    ) {
      setIsFilter(false);
    }
  }, [
    currentFile?.tableName,
    currentFile?.tableFilter?.filter?.length,
    isFetching,
    isFilter,
  ]);

  const handleIsFilter = () => {
    setIsFilter(!isFilter);
    if (!isFilter) {
      dispatch(
        updateFile({
          id: currentFile?.id,
          tableFilter: {
            filter: [
              {
                column: columns[0],
                compare: "equals",
                value: "",
                separator: "WHERE",
              },
            ],
            applyFilter: false,
          },
        })
      );
    } else {
      dispatch(
        updateFile({
          id: currentFile?.id,
          tableFilter: { filter: [], applyFilter: true },
        })
      );
    }
  };

  return (
    <div
      className={cn("h-[calc(100vh-3rem)] px-0", {
        "h-[calc(100%-2.3rem)]": isSmall,
      })}
    >
      {!isFetching && (!columns || columns?.length === 0) ? (
        <div className="h-full flex items-center justify-center">
          <p className="text-muted-foreground">No data found</p>
        </div>
      ) : (
        <>
          <div className="py-2" ref={filterRef}>
            <div className="h-10 flex items-center justify-between gap-2 px-4">
              <div>
                {isFetching ? (
                  <LoaderCircleIcon
                    className="animate-spin text-muted-foreground"
                    size={12}
                  />
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {gridRows.length} row{gridRows.length > 0 && "s"}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {refetchData && (
                  <Button
                    variant={"outline"}
                    size={"icon"}
                    onClick={refetchData}
                    className="h-7 w-7 border-border [&_svg]:size-3"
                  >
                    <RefreshCcwIcon />
                  </Button>
                )}
                <Button
                  variant={"outline"}
                  onClick={handleIsFilter}
                  className="h-7 px-2 border-border [&_svg]:size-3"
                >
                  <ListFilterIcon />
                  Filter
                </Button>
              </div>
            </div>
            <div className="overflow-auto max-h-40 scrollable-container-gutter">
              {isFilter && <Filter columns={columns} />}
            </div>
          </div>
          {isFetching ? (
            <div className="h-full w-full flex items-center justify-center gap-2">
              <LoaderCircleIcon className="animate-spin text-primary" />
              <p>Fetching...</p>
            </div>
          ) : (
            <div
              style={{
                height: isSmall
                  ? `calc(100% - ${
                      filterDivHeight ? filterDivHeight + "px" : "2.3rem"
                    })`
                  : `calc(100vh - ${
                      filterDivHeight ? filterDivHeight + 42 + "px" : "5.5rem"
                    })`,
              }}
            >
              {(selectedRows.length > 0 ||
                Object.keys(changedRows).length > 0) && (
                <FloatingActions
                  selectedRows={selectedRows}
                  changedRows={changedRows}
                  tableName={currentFile?.tableName}
                  updatedRows={gridRows}
                  handleUpdateTableChanges={handleUpdateChanges}
                />
              )}
              <ReactDataGrid
                columns={updatedColumns} // Dynamically set columns
                rows={gridRows} // Dynamically set rows
                rowHeight={30} // Row height
                headerRowHeight={40} // Header row height
                sortColumns={sortColumns}
                onSortColumnsChange={setSortColumns}
                onRowsChange={handleRowChange} // Handling row changes
                rowClass={(_, rowIndex) => {
                  let classNames = "bg-background ";
                  if (changedRows[rowIndex]) {
                    classNames += "bg-primary/10 ";
                  }
                  if (selectedRows.includes(rowIndex)) {
                    classNames += "bg-destructive/20 ";
                  }
                  return classNames;
                }}
                className="fill-grid h-full bg-background react-data-grid"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Table;
