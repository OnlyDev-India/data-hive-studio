"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialFormData } from "@/config/table-initial-form-data";
import { TableForm } from "@/types/table.type";
import { ChevronDownIcon, LoaderCircleIcon, PlusIcon } from "lucide-react";
import React, { useEffect, useState } from "react";
import ReactDataGrid, { Column, RenderCellProps } from "react-data-grid";
import { columns } from "./column";
import "react-data-grid/lib/styles.css";
import { useDispatch, useSelector } from "react-redux";
import { updateFile } from "@/redux/features/open-files";
import { toast } from "sonner";
import { executeQuery } from "@/lib/actions/fetch-data";
import { fetchTables } from "@/redux/features/tables";
import { FileNewTableType } from "@/types/file.type";

const NewTableView = () => {
  const [formData, setFormData] = useState<TableForm | null>(null);
  const [invalidData, setInvalidData] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const { currentFile }: { currentFile: FileNewTableType } = useSelector(
    (state: any) => state.openFiles,
  );
  const { tables, currentSchema } = useSelector((state: any) => state.tables);

  const dispatch = useDispatch();

  const createQueryToCreateTable = () => {
    if (!formData || !formData.name || !formData.columns?.length) return;

    const invalidRows: number[] = [];

    formData.columns.forEach((column: any, index: number) => {
      const { name, type, keyType, foreignTable } = column;

      if (!name || !type || name === "" || type?.trim() === "") {
        invalidRows.push(index);
      }

      if (
        keyType === "FOREIGN" &&
        (!foreignTable || foreignTable?.trim() === "")
      ) {
        invalidRows.push(index);
      }
    });

    // If there are invalid rows, return them for error handling
    if (invalidRows.length > 0) {
      setInvalidData(invalidRows);
      setTimeout(() => {
        setInvalidData([]);
      }, 5000);
      toast.error("In completed columns");
      // return { error: "Invalid columns", invalidRows };
    }

    const query = `CREATE TABLE ${currentSchema}."${formData.name}" (
      ${formData.columns
        .map((column: any) => {
          const {
            name,
            type,
            isNull,
            defaultValue,
            keyType,
            foreignTable,
            foreignTableColumn,
          } = column;

          if (!name || !type) {
            throw new Error(
              `Invalid column definition: ${JSON.stringify(column)}`,
            );
          }

          const nullConstraint = isNull ? "NULL" : "";
          const defaultConstraint = defaultValue
            ? `DEFAULT ${defaultValue}`
            : "";
          const keyConstraint =
            keyType === "PRIMARY"
              ? "PRIMARY KEY"
              : keyType === "FOREIGN" && foreignTableColumn && foreignTable
                ? `REFERENCES ${currentSchema}."${foreignTable}"(${foreignTableColumn})`
                : "";

          return `${name} ${type} ${nullConstraint} ${defaultConstraint} ${keyConstraint}`.trim();
        })
        .join(",\n    ")}
    )`;

    return query;
  };

  const updatedColumns: Column<any>[] = columns.map((column) => {
    const customRenderCell = column.customRenderCell;
    const renderCell = column.renderCell;
    return {
      cellClass:
        "text-xs md:text-sm flex items-center text-foreground aria-[selected='true']:outline-none border-b-4 border-secondary",
      headerCellClass:
        "bg-secondary text-muted-foreground aria-[selected='true']:outline-none !w-full sticky -right-[100%]",
      ...column,

      renderCell: (props: RenderCellProps<any>) =>
        customRenderCell
          ? customRenderCell(props, {
              deleteColumn,
              getForeignTableFields,
              tables,
            })
          : renderCell && renderCell(props),
    };
  });

  const setInitialData = (newTable = false) => {
    if (!currentFile) return;

    if (currentFile.tableForm && !newTable) {
      setFormData(currentFile.tableForm);
      return;
    }
    const cookies = document.cookie.split("; ").reduce(
      (acc, cookie) => {
        const [name, value] = cookie.split("=");
        acc[name] = decodeURIComponent(value);
        return acc;
      },
      {} as Record<string, string>,
    );

    const dbType = cookies["dbType"];
    const initialData = initialFormData[dbType as keyof typeof initialFormData];
    setFormData(initialData as TableForm);
    dispatch(updateFile({ id: currentFile?.id, tableForm: initialData }));
  };

  useEffect(() => {
    // get dbType from cookies

    setInitialData();
  }, [currentFile?.tableName]);

  const handleCreateTable = async () => {
    const query = createQueryToCreateTable();
    if (!query) return;
    setLoading(true);
    const { data, error } = await executeQuery(query);
    if (data) {
      setInitialData(true);
      toast.success("Table created successfully");
      dispatch(fetchTables() as any);
    } else if (error) {
      toast.error(error);
    } else {
      toast.error("Something went wrong");
    }
    setLoading(false);
  };

  const addNewColumn = () => {
    const updatedFormData = {
      ...formData,
      columns: [
        ...(formData?.columns || []),
        {
          name: "",
          type: "",
          isNull: false,
          defaultValue: "",
          keyType: "",
        },
      ],
    };
    setFormData(updatedFormData as any);
    dispatch(updateFile({ id: currentFile?.id, tableForm: updatedFormData }));
  };

  const deleteColumn = (index: number) => {
    const updatedFormData = {
      ...formData,
      columns: formData?.columns?.filter((_, i) => i !== index),
    };
    setFormData(updatedFormData as any);
    dispatch(updateFile({ id: currentFile?.id, tableForm: updatedFormData }));
  };

  const handleDataChange = (rows: any[]) => {
    const updatedFormData = { ...formData, columns: rows };
    setFormData(updatedFormData as any);
    dispatch(updateFile({ id: currentFile?.id, tableForm: updatedFormData }));
  };

  const getForeignTableFields = (rowIdx: number) => {
    const foreignTable = formData?.columns?.[rowIdx]?.foreignTable;

    let fields;
    if (foreignTable) {
      fields = tables.find(
        (table: any) => table.table_name === foreignTable,
      )?.fields;
      const options = fields
        ?.filter((field: any) => field.key_type === "PRIMARY KEY")
        .map((field: any) => ({
          label: field.name,
          value: field.name,
        }));
      return options;
    }
    return false;
  };

  return (
    <div className="h-[calc(100%-var(--tabs-height))] bg-secondary px-4 py-6">
      {formData && (
        <div className="h-full space-y-4">
          <div className="flex h-7 items-center gap-2">
            <Label htmlFor="name" className="whitespace-nowrap">
              Table Name
            </Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => {
                setFormData({ ...formData, name: e.target.value });
              }}
              className="bg-popover py-0 text-xs"
            />
            <div className="flex gap-0.5">
              <Button
                className="h-7 rounded-r-none text-white"
                onClick={handleCreateTable}
                disabled={loading}
              >
                {loading && <LoaderCircleIcon className="animate-spin" />}
                Create Table
              </Button>
              <Button
                disabled={loading}
                className="h-7 rounded-l-none px-1 text-white"
              >
                <ChevronDownIcon />
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <h2>Columns</h2>
            <Button
              className="h-7 w-7 rounded-full px-1 text-white"
              onClick={addNewColumn}
              disabled={loading}
            >
              <PlusIcon />
            </Button>
          </div>
          <div className="h-[calc(100%-4rem)]">
            <ReactDataGrid
              columns={updatedColumns as any}
              rows={formData.columns}
              rowHeight={40} // Row height
              headerRowHeight={50} // Header row height
              onRowsChange={(newRows) => handleDataChange(newRows)} // Handling row changes
              rowClass={(_, rowInd) => {
                let outputClass = "bg-background";
                if (invalidData.includes(rowInd)) {
                  outputClass += "!bg-destructive/10 ";
                }
                return outputClass;
              }}
              className="react-data-grid-new-table h-full bg-transparent"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default NewTableView;
