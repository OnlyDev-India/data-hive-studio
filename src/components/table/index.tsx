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
import {
  ArrowDownWideNarrowIcon,
  ArrowUpNarrowWideIcon,
  ChevronsUpDownIcon,
  ListFilterIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCcwIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ForeignKeyCells from "../table-cells/foreign-key-cells";
import { Checkbox } from "../ui/checkbox";
import SelectCell from "../table-cells/select-cell";
import InputCell from "../table-cells/input-cell";
import FloatingActions from "./floating-action";
import { useDispatch, useSelector } from "react-redux";
import { updateFile } from "@/redux/features/open-files";
import ExportTable from "./export-table";
import { Row } from "@/types/table.type";
import { FileTableType, RefetchType } from "@/types/file.type";
import Pagination from "./pagination";
import { isNoSql } from "@/lib/helper/checkDbType";
import NoSqlTable from "./no-sql-table";
import { getCurrentDatabaseType } from "@/lib/actions/fetch-data";

// Define the structure of the data (you can update this based on your actual data)
export interface ColumnProps extends Column<any> {
  data_type?: string;
  key_type?: string;
  is_enum?: boolean;
  enum_values?: string[];
  foreignTable?: string;
  foreignColumn?: string;
}

interface TableProps {
  columns: ColumnProps[] ;
  data: Row[];
  refetchData?: () => void;
  isFetching?: RefetchType;
  dbType: string;
}

const Table = ({
  columns,
  data,
  refetchData,
  isFetching,
  dbType,
}: TableProps) => {
  // React Data Grid requires columns and rows
  const [gridRows, setGridRows] = useState<Row[]>([]);

  const [filterDivHeight, setFilterDivHeight] = useState<number>(40);

  const { currentFile }: { currentFile: FileTableType } = useSelector(
    (state: any) => state.openFiles,
  );
  const { changedRows, insertedRows, selectedRows } =
    currentFile.tableOperations || {};
  const dispatch = useDispatch();

  const filterRef = useRef<HTMLDivElement>(null);

  const isFloatingActionsVisible =
    (selectedRows && selectedRows.length > 0) ||
    (changedRows && Object.keys(changedRows).length > 0) ||
    (insertedRows ? insertedRows > 0 : false);

  const isNosql = isNoSql(dbType);

  const handleAddRecord = async () => {
    const newRow: any = {};
    const dbType = await getCurrentDatabaseType();
    if (dbType === "mongodb" && columns.length === 0) {
      newRow["_id"] = "";
    } else {
      Object.keys(columns).forEach((column) => {
        const { key } = columns[parseInt(column)];
        if (key) {
          newRow[key] = "";
        }
      });
    }
    newRow["isNew"] = true;
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableData: {
          columns: currentFile?.tableData?.columns,
          rows: [newRow, ...gridRows],
          totalRecords: currentFile?.tableData?.totalRecords,
        },
        tableOperations: {
          ...currentFile?.tableOperations,
          insertedRows: gridRows.filter((row) => row.isNew)?.length + 1,
        },
      }),
    );
    // setIsNewRows(true);
  };

  const handleRemoveNewRecord = (rowIdx?: number) => {
    let newRows;

    if (rowIdx === 0 || rowIdx) {
      newRows = gridRows.filter((_, index) => index !== rowIdx);
    } else {
      newRows = gridRows.filter((row) => !row.isNew);
    }

    dispatch(
      updateFile({
        id: currentFile?.id,
        tableData: {
          columns: currentFile?.tableData?.columns,
          rows: newRows,
          totalRecords: currentFile?.tableData?.totalRecords,
        },
        tableOperations: {
          ...currentFile?.tableOperations,
          insertedRows: newRows.filter((row) => row.isNew)?.length,
        },
      }),
    );
  };

  const setSelectedRows = (selectRows: number[]) => {
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableOperations: {
          ...currentFile?.tableOperations,
          selectedRows: selectRows,
        },
      }),
    );
  };

  const updatedColumns: Column<any>[] = useMemo(() => {
    const newColumns = columns.map((column) => {
      const data_type = column.data_type;

      return {
        ...column,
        width: 200,
        resizable: true,
        sortable: true,
        cellClass: (row: any) => {
          return cn(
            "text-xs md:text-sm flex items-center text-foreground aria-[selected='true']:outline-primary aria-[selected='true']:rounded-md border" +
              ` ${
                row.isNew
                  ? "aria-[selected='false']:text-yellow-800 aria-[selected='true']:bg-background"
                  : ""
              }`,
          );
        },
        headerCellClass:
          "bg-muted text-muted-foreground aria-[selected='true']:outline-primary aria-[selected='true']:rounded-md border !w-full sticky -right-[100%]",
        renderHeaderCell: ({ column }: any) => (
          <div className="flex h-full w-full cursor-pointer items-center justify-between">
            <p className="flex gap-2">
              {column.key_type === "PRIMARY KEY" && <span>🔑</span>}
              {column.key_type === "FOREIGN KEY" && <span>🔗</span>}
              <span>{column.name}</span>
              <span className="max-w-[100px] truncate rounded-md bg-background p-0.5 px-4 text-xs text-muted-foreground">
                {data_type}
              </span>
            </p>
            <span>
              {currentFile?.tableOrder?.[0]?.columnKey === column.key ? (
                currentFile?.tableOrder?.[0]?.direction === "ASC" ? (
                  <ArrowUpNarrowWideIcon size={14} />
                ) : (
                  <ArrowDownWideNarrowIcon size={14} />
                )
              ) : (
                <ChevronsUpDownIcon size={14} />
              )}
            </span>
          </div>
        ),
        renderCell: (props: any) => {
          // const { row, column } = props;
          if (column.key_type === "FOREIGN KEY") {
            return <ForeignKeyCells {...props} disabled={false} />;
          }
          if (column.is_enum) {
            return (
              <SelectCell
                name={column.key}
                className="px-3"
                {...props}
                items={column.enum_values?.map((value: string) => ({
                  label: value,
                  value: value,
                }))}
              />
            );
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
          return (
            <InputCell
              name={column.key}
              {...props}
              className="!border-0 px-3"
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
        "!bg-secondary hover:!bg-secondary !rounded-none aria-[selected='true']:outline-none border",
      headerCellClass:
        "bg-muted text-muted-foreground aria-[selected='true']:outline-none border",
      renderHeaderCell: () => {
        const isChecked =
          selectedRows &&
          selectedRows.length === gridRows.length &&
          gridRows.length > 0;
        const handleCheckedChanges = (checked: boolean) => {
          if (checked) {
            setSelectedRows(gridRows.map((_, index) => index));
          } else {
            setSelectedRows([]);
          }
        };
        return (
          <div className="group flex w-full items-center justify-center">
            <Checkbox
              checked={isChecked}
              className={cn("invisible group-hover:visible", {
                visible: selectedRows && selectedRows.length > 0,
                "!invisible": !currentFile?.tableName,
              })}
              onCheckedChange={handleCheckedChanges}
            />
          </div>
        );
      },
      renderCell: ({ row, rowIdx }: RenderCellProps<any>) => {
        const selectedRowsSet = new Set(selectedRows);
        const selectedRowsArray = Array.from(selectedRowsSet);
        const handleCheckedChanges = (checked: boolean) => {
          if (checked) {
            selectedRowsArray.push(rowIdx);
            setSelectedRows(selectedRowsArray);
          } else {
            selectedRowsArray.splice(selectedRowsArray.indexOf(rowIdx), 1);
            setSelectedRows(selectedRowsArray);
          }
        };

        return (
          <div className="group flex h-full w-full items-center justify-center">
            {row.isNew ? (
              <Button
                variant="ghost"
                size={"icon"}
                className="h-full w-full p-0 [&_svg]:size-3"
                onClick={() => handleRemoveNewRecord(rowIdx)}
              >
                <XIcon />
              </Button>
            ) : (
              <>
                <Checkbox
                  checked={selectedRowsArray.includes(rowIdx)}
                  onCheckedChange={handleCheckedChanges}
                  className={cn("hidden group-hover:inline-block", {
                    "inline-block": selectedRowsArray.length > 0,
                    "!hidden": !currentFile?.tableName,
                  })}
                />
                <p
                  className={cn("inline-block group-hover:hidden", {
                    hidden: selectedRowsArray.length > 0,
                    "!inline-block": !currentFile?.tableName,
                  })}
                >
                  {rowIdx + 1}
                </p>
              </>
            )}
          </div>
        );
      },
    };

    return [checkBoxColumn, ...newColumns];
  }, [columns, currentFile?.tableOrder, selectedRows, gridRows]);

  const handleShortData = (cols: readonly SortColumn[]) => {
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableOrder: cols,
        tableRefetch: "sort:" + cols[0]?.direction.toString(),
      }),
    );
  };

  const handleRowChange = (rows: Row[], changesRows: any) => {
    const rowIndexes = changesRows.indexes;
    const newRow = rows[rowIndexes[0]];
    // console.log({ ...changedRows, [rowIndexes[0]]: row });
    const oldRow = gridRows[rowIndexes[0]];
    const changedData = { ...changedRows };
    if (newRow.isNew) {
      // return;
    } else if (changedData[rowIndexes[0]]?.old) {
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
      !newRow.isNew &&
      JSON.stringify(changedData[rowIndexes[0]].old) ===
        JSON.stringify(changedData[rowIndexes[0]].new)
    ) {
      delete changedData[rowIndexes[0]];
    }

    // console.log(changedData);
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableData: {
          columns: currentFile?.tableData?.columns,
          rows: rows,
          totalRecords: currentFile?.tableData?.totalRecords,
        },
        tableOperations: {
          ...currentFile?.tableOperations,
          changedRows: changedData,
        },
      }),
    );
    // setGridRows(rows);
  };

  const handleResetChanges = () => {
    const restoredRows = JSON.parse(JSON.stringify(data)).filter(
      (row: any) => !row.isNew,
    );

    if (changedRows) {
      Object.entries(changedRows).forEach(([index, change]: [string, any]) => {
        restoredRows[parseInt(index)] = change.old;
      });
    }

    dispatch(
      updateFile({
        id: currentFile?.id,
        tableData: {
          columns: currentFile?.tableData?.columns,
          rows: restoredRows,
          totalRecords: currentFile?.tableData?.totalRecords,
        },
        tableOperations: {
          changedRows: {},
          insertedRows: 0,
          selectedRows: [],
        },
      }),
    );
  };

  const handleUpdateChanges = (type: string) => {
    switch (type) {
      case "update":
        dispatch(
          updateFile({
            id: currentFile?.id,
            tableOperations: {
              ...currentFile?.tableOperations,
              changedRows: {},
            },
          }),
        );
        return;
      case "delete":
        setSelectedRows([]);
        return;
      default:
        handleResetChanges();
        // setGridRows(data);
        return;
    }
  };

  const updatedData = useMemo(() => {
    const changedRows = currentFile?.tableOperations?.changedRows;
    if (!changedRows) return data;

    if (Object.keys(changedRows).length > 0) {
      const keys = Object.keys(changedRows);
      const newRows = [...data];
      keys.forEach((key) => {
        newRows[+key] = changedRows[+key].new;
      });
      return newRows;
    }
    return data;
  }, [data, currentFile?.tableOperations?.changedRows]);

  useEffect(() => {
    setGridRows(updatedData as any);
  }, [updatedData, currentFile?.tableName]);
  const updateDivHeight = () => {
    if (filterRef.current) {
      setFilterDivHeight(filterRef.current.offsetHeight || 0);
    }
  };

  useEffect(() => {
    updateDivHeight();
  }, [
    filterRef.current,
    currentFile?.tableName,
    currentFile?.tableFilter?.filterOpened,
    currentFile?.tableFilter?.filter?.newFilter,
    isFetching === null,
  ]);

  const handleIsFilter = () => {
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableFilter: {
          ...currentFile?.tableFilter,
          filterOpened: !currentFile?.tableFilter?.filterOpened,
        },
      }),
    );
  };

  return (
    <div className={cn("h-full px-0")}>
      <>
        <div ref={filterRef}>
          <div className="flex h-10 items-center justify-between gap-2 px-4">
            <Pagination isFetching={isFetching} />
            <div className="flex items-center gap-2">
              {currentFile?.tableName && (
                <>
                  <Button
                    variant={"outline"}
                    onClick={handleAddRecord}
                    className="h-7 border-border px-2 [&_svg]:size-3"
                    disabled={!columns || isFetching !== null}
                  >
                    <PlusIcon />
                    Add Record
                  </Button>
                  <Button
                    variant={"outline"}
                    onClick={handleIsFilter}
                    className="relative h-7 border-border px-2 [&_svg]:size-3"
                    disabled={
                      !columns || columns?.length === 0 || isFetching !== null
                    }
                  >
                    <ListFilterIcon />
                    Filter
                    {currentFile?.tableFilter?.filter?.oldFilter?.length >
                      0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border bg-popover text-xs">
                        {currentFile?.tableFilter?.filter?.oldFilter?.length}
                      </span>
                    )}
                  </Button>
                </>
              )}
              {refetchData && (
                <Button
                  variant={"outline"}
                  size={"icon"}
                  onClick={refetchData}
                  disabled={isFetching !== null}
                  className="h-7 w-7 border-border [&_svg]:size-3"
                >
                  <RefreshCcwIcon
                    className={cn({ "animate-spin": isFetching })}
                  />
                </Button>
              )}
              <ExportTable
                columns={columns}
                data={gridRows}
                selectedData={selectedRows}
              />
            </div>
          </div>
          {currentFile?.tableFilter?.filterOpened && (
            <div className="scrollable-container-gutter max-h-40 overflow-auto bg-secondary p-4">
              <Filter columns={columns} />
            </div>
          )}
        </div>
        {isFetching === null &&
        (!updatedColumns || updatedColumns?.length === 0) ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">No data found</p>
          </div>
        ) : isFetching === "fetch" ? (
          <div className="flex h-full w-full items-center justify-center gap-2">
            <LoaderCircleIcon className="animate-spin text-primary" />
            <p>Fetching...</p>
          </div>
        ) : (
          <div
            style={{
              height: `calc(100% - ${filterDivHeight + "px"})`,
            }}
          >
            {/* {isFloatingActionsVisible && ( */}
              <FloatingActions
                selectedRows={selectedRows}
                changedRows={changedRows}
                tableName={currentFile?.tableName || ""}
                updatedRows={gridRows}
                handleUpdateTableChanges={handleUpdateChanges}
                isFloatingActionsVisible={isFloatingActionsVisible}
              />
            {/* )} */}
            {isNosql ? (
              <NoSqlTable
                rows={gridRows}
                handleRemoveNewRecord={handleRemoveNewRecord}
                selectedRows={selectedRows}
                setSelectedRows={setSelectedRows}
              />
            ) : (
              <ReactDataGrid
                columns={updatedColumns} // Dynamically set columns
                rows={gridRows} // Dynamically set rows
                rowHeight={30} // Row height
                headerRowHeight={40} // Header row height
                sortColumns={currentFile?.tableOrder || []}
                onSortColumnsChange={handleShortData}
                onRowsChange={handleRowChange} // Handling row changes
                rowClass={(row, rowIndex) => {
                  let classNames = "bg-secondary ";
                  if (changedRows?.[rowIndex]) {
                    classNames += "!bg-primary/10 ";
                  }
                  if (selectedRows && selectedRows.includes(rowIndex)) {
                    classNames += "!bg-destructive/20 ";
                  }
                  if (row.isNew) {
                    classNames += "bg-yellow-100 ";
                  }
                  return classNames;
                }}
                className="fill-grid react-data-grid h-full rounded-b-lg bg-secondary"
              />
            )}
          </div>
        )}
      </>
    </div>
  );
};

export default Table;
