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
  Edit3Icon,
  CheckIcon,
  TableIcon,
  FileTextIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ForeignKeyCells from "../table-cells/foreign-key-cells";
import { Checkbox } from "../ui/checkbox";
import SelectCell from "../table-cells/select-cell";
import InputCell from "../table-cells/input-cell";
import { Input } from "../ui/input";

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
  columns: ColumnProps[];
  data: Row[];
  refetchData?: () => void;
  isFetching?: RefetchType;
  dbType: string;
}

// Helper function to format NoSQL values for display
const formatNoSqlValue = (value: any): string => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    return value.length > 50 ? value.substring(0, 50) + "..." : value;
  }
  return String(value);
};

// Inline Object Editor Component for expandable sub-tables
interface InlineObjectEditorProps {
  objectData: any;
  rowIndex: number;
  columnKey: string;
  onSave: (rowIndex: number, columnKey: string, updatedObject: any) => void;
}

const InlineObjectEditor = ({
  objectData,
  rowIndex,
  columnKey,
  onSave,
}: InlineObjectEditorProps) => {
  const [editableData, setEditableData] =
    useState<Record<string, any>>(objectData);
  const [newFieldName, setNewFieldName] = useState("");

  const handleFieldChange = (key: string, value: any) => {
    setEditableData((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const addNewField = () => {
    if (
      newFieldName.trim() &&
      !editableData.hasOwnProperty(newFieldName.trim())
    ) {
      setEditableData((prev) => ({
        ...prev,
        [newFieldName.trim()]: "",
      }));
      setNewFieldName("");
    }
  };

  const removeField = (key: string) => {
    setEditableData((prev) => {
      const newData = { ...prev };
      delete newData[key];
      return newData;
    });
  };

  const handleSave = () => {
    onSave(rowIndex, columnKey, editableData);
  };

  return (
    <div className="my-2 ml-4 rounded-r-md border-l-4 border-primary bg-muted/30 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-muted-foreground">
          Editing: {columnKey}
        </h4>
        <Button size="sm" onClick={handleSave} className="h-7 px-3 text-xs">
          Save
        </Button>
      </div>

      <div className="max-h-48 space-y-2 overflow-auto">
        {Object.entries(editableData).map(([key, value]) => (
          <div
            key={key}
            className="flex items-center gap-2 rounded border bg-background p-2"
          >
            <span className="min-w-[80px] text-xs font-medium">{key}</span>
            <Input
              value={typeof value === "string" ? value : String(value || "")}
              onChange={(e) => handleFieldChange(key, e.target.value)}
              className="h-7 flex-1 text-xs"
              placeholder="Enter value"
            />
            <span className="min-w-[60px] text-xs text-muted-foreground">
              {Array.isArray(value) ? "array" : typeof value}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              onClick={() => removeField(key)}
            >
              <XIcon size={10} />
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <Input
          value={newFieldName}
          onChange={(e) => setNewFieldName(e.target.value)}
          placeholder="New field name"
          className="h-7 flex-1 text-xs"
          onKeyPress={(e) => e.key === "Enter" && addNewField()}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={addNewField}
          disabled={!newFieldName.trim()}
          className="h-7 px-2 text-xs"
        >
          Add
        </Button>
      </div>
    </div>
  );
};

const Table = ({
  columns,
  data,
  refetchData,
  isFetching,
  dbType,
}: TableProps) => {
  // We're now using the data prop directly instead of managing local state
  // const [gridRows, setGridRows] = useState<Row[]>([]);

  const [filterDivHeight, setFilterDivHeight] = useState<number>(40);
  const [viewMode, setViewMode] = useState<"table" | "json">("table");
  const [expandedObjects, setExpandedObjects] = useState<Set<string>>(
    new Set(),
  );

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
          rows: [newRow, ...data],
          totalRecords: currentFile?.tableData?.totalRecords,
        },
        tableOperations: {
          ...currentFile?.tableOperations,
          insertedRows: data.filter((row) => row.isNew)?.length + 1,
        },
      }),
    );
    // setIsNewRows(true);
  };

  const toggleObjectExpansion = (rowIndex: number, columnKey: string) => {
    const key = `${rowIndex}-${columnKey}`;
    setExpandedObjects((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const isObjectExpanded = (rowIndex: number, columnKey: string) => {
    return expandedObjects.has(`${rowIndex}-${columnKey}`);
  };

  const saveObjectChanges = (
    rowIndex: number,
    columnKey: string,
    updatedObject: any,
  ) => {
    // Create updated rows with the modified object
    const updatedRows = data.map((row, idx) => {
      if (idx === rowIndex) {
        return {
          ...row,
          [columnKey]: updatedObject,
        };
      }
      return row;
    });

    // Update the grid data
    const changes = { indexes: [rowIndex], column: { key: columnKey } };
    handleRowChange(updatedRows, changes);
  };

  const handleRemoveNewRecord = (rowIdx?: number) => {
    let newRows;

    if (rowIdx === 0 || rowIdx) {
      newRows = data.filter((_, index) => index !== rowIdx);
    } else {
      newRows = data.filter((row) => !row.isNew);
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
    // For NoSQL databases, dynamically create columns from data if none exist
    let columnsToUse = columns;
    if (isNosql && columns.length === 0 && data.length > 0) {
      // Extract all unique keys from all documents
      const allKeys = new Set<string>();
      data.forEach((row: any) => {
        Object.keys(row).forEach((key) => {
          if (key !== "isNew") allKeys.add(key);
        });
      });

      columnsToUse = Array.from(allKeys).map((key) => ({
        key,
        name: key,
        data_type: typeof data.find((r: any) => r[key])?.[key] || "string",
        width: 200,
        resizable: true,
        sortable: true,
      }));
    }

    const newColumns = columnsToUse.map((column) => {
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

          // For MongoDB and other NoSQL databases, use custom cell renderer
          if (isNosql) {
            const cellValue = props.row[column.key];
            const isObjectValue =
              typeof cellValue === "object" &&
              cellValue !== null &&
              !Array.isArray(cellValue);

            return (
              <div className="flex items-center gap-2">
                {isObjectValue ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      {Object.keys(cellValue).length} fields
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      disabled={true} //TODO: remove this
                      onClick={() => {
                        // Toggle sub-table expansion for editing object
                        toggleObjectExpansion(props.rowIdx, column.key);
                      }}
                    >
                      {isObjectExpanded(props.rowIdx, column.key) ? (
                        <ChevronDownIcon size={12} />
                      ) : (
                        <ChevronRightIcon size={12} />
                      )}
                    </Button>
                  </>
                ) : (
                  <Input
                    value={formatNoSqlValue(cellValue)}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      const newRow = {
                        ...props.row,
                        [column.key]: e.target.value,
                      };

                      // IMPORTANT: Don't create a new array, modify the existing one
                      // This prevents ReactDataGrid from losing track of row indices
                      const updatedRows = data.map((row, idx) => {
                        if (idx === props.rowIdx) {
                          return newRow;
                        }
                        return row;
                      });

                      // Call onRowChange with the updated rows array
                      props.onRowChange(updatedRows, {
                        indexes: [props.rowIdx],
                        column: column,
                      });
                    }}
                    className="rounded-none border-0 border-primary p-0 hover:border-b-2 focus-visible:border-b-2 focus-visible:outline-none focus-visible:ring-0"
                    placeholder="null"
                  />
                )}
              </div>
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
          selectedRows.length === data.length &&
          data.length > 0;
        const handleCheckedChanges = (checked: boolean) => {
          if (checked) {
            setSelectedRows(data.map((_, index) => index));
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
  }, [columns, currentFile?.tableOrder, selectedRows, data]);

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
    // ReactDataGrid sends the full rows array, not individual rows
    // We need to find which rows actually changed
    const changedData = { ...changedRows };

    // IMPORTANT: Fix malformed data structure from ReactDataGrid
    // The grid sometimes sends nested arrays instead of flat row objects
    const sanitizedRows = rows.map((row, index) => {
      if (Array.isArray(row)) {
        // The issue: ReactDataGrid is sending the wrong data structure
        // We need to find the correct row data for this index
        if (
          row.length > index &&
          row[index] &&
          typeof row[index] === "object"
        ) {
          // If the array has an element at the correct index, use it
          return row[index];
        } else if (row.length > 0 && row[0] && typeof row[0] === "object") {
          // Fallback: use the first element if it has the right structure
          return row[0];
        } else {
          // Last resort: return the original row
          return row;
        }
      }
      return row;
    });

    // Process each change
    if (changesRows.indexes && changesRows.indexes.length > 0) {
      changesRows.indexes.forEach((rowIndex: number) => {
        const newRow = sanitizedRows[rowIndex];
        const oldRow = data[rowIndex];

        if (newRow && oldRow) {
          // Process this row change
          processRowChange(rowIndex, newRow, oldRow, changedData);
        }
      });
    }

    // Update Redux store with sanitized rows
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableData: {
          columns: currentFile?.tableData?.columns,
          rows: sanitizedRows, // Use sanitized rows to fix data structure
          totalRecords: currentFile?.tableData?.totalRecords,
        },
        tableOperations: {
          ...currentFile?.tableOperations,
          changedRows: changedData,
        },
      }),
    );
  };

  // Helper function to process individual row changes
  const processRowChange = (
    rowIndex: number,
    newRow: any,
    oldRow: any,
    changedData: any,
  ) => {
    // Additional safety check - handle the case where newRow might still be an array
    let processedNewRow = newRow;
    if (Array.isArray(newRow)) {
      processedNewRow = newRow[0] || newRow; // Extract first element if it's an array
    }

    // Validate that we have a proper row object
    if (!processedNewRow || typeof processedNewRow !== "object") {
      return;
    }

    // Sanitize the new row data to remove undefined values and clean up data
    const sanitizedNewRow = { ...processedNewRow };
    Object.keys(sanitizedNewRow).forEach((key) => {
      const value = sanitizedNewRow[key];

      // Convert "$undefined" strings back to undefined
      if (value === "$undefined" || value === "undefined") {
        sanitizedNewRow[key] = undefined;
      }

      // Convert empty strings to null for better database handling
      // Don't convert _id field to null as it's required for MongoDB updates
      if (value === "" && key !== "_id") {
        sanitizedNewRow[key] = null;
      }

      // Ensure boolean values are properly typed
      if (
        typeof value === "string" &&
        (value === "true" || value === "false")
      ) {
        sanitizedNewRow[key] = value === "true";
      }

      // For MongoDB, ensure _id is preserved as string if it's an ObjectId
      if (
        key === "_id" &&
        value &&
        typeof value === "object" &&
        value.toString
      ) {
        sanitizedNewRow[key] = value.toString();
      }
    });

    // Only track changes for non-new rows
    if (!sanitizedNewRow.isNew) {
      if (changedData[rowIndex]?.old) {
        changedData[rowIndex] = {
          old: changedData[rowIndex].old,
          new: sanitizedNewRow,
        };
      } else {
        changedData[rowIndex] = {
          old: oldRow,
          new: sanitizedNewRow,
        };
      }

      // Only remove from tracking if the row is exactly the same (no changes)
      if (
        JSON.stringify(changedData[rowIndex].old) ===
        JSON.stringify(changedData[rowIndex].new)
      ) {
        delete changedData[rowIndex];
      }
    }
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

  // updatedData is now just a reference to data since we're using data directly
  const updatedData = useMemo(() => data, [data]);

  // No need to initialize gridRows since we're using data prop directly
  // useEffect(() => {
  //   if (data && data.length > 0) {
  //     console.log('Initializing gridRows with data:', data.length);
  //     setGridRows(data);
  //   }
  // }, [data]);
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
            <div className="flex items-center gap-4">
              <Pagination isFetching={isFetching} />
              {/* View Mode Toggle for NoSQL databases */}
              {isNosql && (
                <div className="flex items-center gap-2">
                  <div className="flex rounded-md border border-border">
                    <Button
                      variant={viewMode === "table" ? "default" : "ghost"}
                      size="sm"
                      className="h-7 rounded-r-none border-r border-border px-3 text-xs"
                      onClick={() => setViewMode("table")}
                    >
                      <TableIcon size={14} className="mr-1" />
                    </Button>
                    <Button
                      variant={viewMode === "json" ? "default" : "ghost"}
                      size="sm"
                      className="h-7 rounded-l-none px-3 text-xs"
                      onClick={() => setViewMode("json")}
                    >
                      <FileTextIcon size={14} className="mr-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
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
                data={data}
                selectedData={selectedRows}
              />
            </div>
          </div>
          {currentFile?.tableFilter?.filterOpened && (
            <div className="scrollable-container-gutter max-h-40 overflow-auto bg-secondary px-4 mb-4 relative">
              <Filter columns={columns} dbType={dbType} viewMode={viewMode} />
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
              userSelect: "text",
            }}
          >
            {/* {isFloatingActionsVisible && ( */}
            <FloatingActions
              selectedRows={selectedRows}
              changedRows={changedRows}
              tableName={currentFile?.tableName || ""}
              updatedRows={data}
              handleUpdateTableChanges={handleUpdateChanges}
              isFloatingActionsVisible={isFloatingActionsVisible}
            />
            {/* )} */}
            {isNosql ? (
              viewMode === "table" ? (
                <div className="relative">
                  <ReactDataGrid
                    columns={updatedColumns} // Dynamically set columns
                    rows={data} // Use data prop directly to avoid state management issues
                    rowHeight={30} // Row height
                    headerRowHeight={40} // Header row height
                    sortColumns={currentFile?.tableOrder || []}
                    onSortColumnsChange={handleShortData}
                    onRowsChange={(newRows, changes) => {
                      handleRowChange(newRows, changes);
                    }}
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

                  {/* Expandable Object Editors */}
                  {data
                    .map((row, rowIndex) =>
                      updatedColumns.map((column) => {
                        const cellValue = row[column.key];
                        const isObjectValue =
                          typeof cellValue === "object" &&
                          cellValue !== null &&
                          !Array.isArray(cellValue);

                        if (
                          isObjectValue &&
                          isObjectExpanded(rowIndex, column.key)
                        ) {
                          return (
                            <div
                              key={`${rowIndex}-${column.key}`}
                              className="absolute left-0 right-0 z-10"
                              style={{ top: `${(rowIndex + 1) * 30 + 40}px` }}
                            >
                              <InlineObjectEditor
                                objectData={cellValue}
                                rowIndex={rowIndex}
                                columnKey={column.key}
                                onSave={saveObjectChanges}
                              />
                            </div>
                          );
                        }
                        return null;
                      }),
                    )
                    .filter(Boolean)}
                </div>
              ) : (
                <NoSqlTable
                  rows={data}
                  handleRemoveNewRecord={handleRemoveNewRecord}
                  selectedRows={selectedRows}
                  setSelectedRows={setSelectedRows}
                />
              )
            ) : (
              <div className="relative h-full">
                <ReactDataGrid
                  columns={updatedColumns} // Dynamically set columns
                  rows={data} // Use data prop directly to avoid state management issues
                  rowHeight={30} // Row height
                  headerRowHeight={40} // Header row height
                  sortColumns={currentFile?.tableOrder || []}
                  onSortColumnsChange={handleShortData}
                  onRowsChange={(newRows, changes) => {
                    handleRowChange(newRows, changes);
                  }}
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

                {/* Expandable Object Editors for SQL */}
                {data
                  .map((row, rowIndex) =>
                    updatedColumns.map((column) => {
                      const cellValue = row[column.key];
                      const isObjectValue =
                        typeof cellValue === "object" &&
                        cellValue !== null &&
                        !Array.isArray(cellValue);

                      if (
                        isObjectValue &&
                        isObjectExpanded(rowIndex, column.key)
                      ) {
                        return (
                          <div
                            key={`${rowIndex}-${column.key}`}
                            className="absolute left-0 right-0 z-10"
                            style={{ top: `${(rowIndex + 1) * 30 + 40}px` }}
                          >
                            <InlineObjectEditor
                              objectData={cellValue}
                              rowIndex={rowIndex}
                              columnKey={column.key}
                              onSave={saveObjectChanges}
                            />
                          </div>
                        );
                      }
                      return null;
                    }),
                  )
                  .filter(Boolean)}
              </div>
            )}
          </div>
        )}
      </>
    </div>
  );
};

export default Table;
