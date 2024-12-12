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
import "./index.css";
import { useDispatch, useSelector } from "react-redux";
import { updateFile } from "@/redux/features/open-files";
import { toast } from "sonner";
import { executeQuery } from "@/lib/actions/fetch-data";
import { fetchTables } from "@/redux/features/tables";

const NewTableView = () => {
  const [formData, setFormData] = useState<TableForm | null>(null);
  const [invalidData, setInvalidData] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const { currentFile } = useSelector((state: any) => state.openFiles);
  const { tables } = useSelector((state: any) => state.tables);

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

    const query = `CREATE TABLE ${formData.name} (
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
              `Invalid column definition: ${JSON.stringify(column)}`
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
              ? `REFERENCES public."${foreignTable}"(${foreignTableColumn})`
              : "";

          return `${name} ${type} ${nullConstraint} ${defaultConstraint} ${keyConstraint}`.trim();
        })
        .join(",\n    ")}
    )`;

    return query;
  };

  const updatedColumns: Column<any>[] = columns.map((column) => {
    const customRenderCell = column.customRenderCell;
    if (!customRenderCell) return column;
    return {
      ...column,
      renderCell: (props: RenderCellProps<any>) =>
        customRenderCell(props, { deleteColumn, getForeignTableFields }),
    };
  });

  const setInitialData = (newTable = false) => {
    if (!currentFile) return;

    if (currentFile.tableData && !newTable) {
      setFormData(currentFile.tableData);
      return;
    }
    const cookies = document.cookie.split("; ").reduce((acc, cookie) => {
      const [name, value] = cookie.split("=");
      acc[name] = decodeURIComponent(value);
      return acc;
    }, {} as Record<string, string>);

    const dbType = cookies["dbType"];
    const initialData = initialFormData[dbType as keyof typeof initialFormData];
    setFormData(initialData as TableForm);
    dispatch(updateFile({ tableData: initialData }));
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
    dispatch(updateFile({ tableData: updatedFormData }));
  };

  const deleteColumn = (index: number) => {
    const updatedFormData = {
      ...formData,
      columns: formData?.columns?.filter((_, i) => i !== index),
    };
    setFormData(updatedFormData as any);
    dispatch(updateFile({ tableData: updatedFormData }));
  };

  const handleDataChange = (rows: any[]) => {
    const updatedFormData = { ...formData, columns: rows };
    setFormData(updatedFormData as any);
    dispatch(updateFile({ tableData: updatedFormData }));
  };

  const getForeignTableFields = (rowIdx: number) => {
    const foreignTable = formData?.columns?.[rowIdx]?.foreignTable;

    let fields;
    if (foreignTable) {
      fields = tables.find(
        (table: any) => table.table_name === foreignTable
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
    <div className="px-4 py-6">
      {formData && (
        <div className="space-y-4">
          <div className="flex gap-2 items-center h-7">
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
                className="text-white h-7 rounded-r-none"
                onClick={handleCreateTable}
                disabled={loading}
              >
                {loading && <LoaderCircleIcon className="animate-spin" />}
                Create Table
              </Button>
              <Button
                disabled={loading}
                className="text-white h-7 rounded-l-none px-1"
              >
                <ChevronDownIcon />
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <h2>Columns</h2>
            <Button
              className="text-white h-7 w-7 rounded-full px-1"
              onClick={addNewColumn}
              disabled={loading}
            >
              <PlusIcon />
            </Button>
          </div>
          <div>
            <ReactDataGrid
              columns={updatedColumns as any}
              rows={formData.columns}
              rowHeight={40} // Row height
              headerRowHeight={50} // Header row height
              onRowsChange={(newRows) => handleDataChange(newRows)} // Handling row changes
              rowClass={(_, rowInd) => {
                let outputClass = "";
                if (invalidData.includes(rowInd)) {
                  outputClass += "rdg-row-invalid";
                }
                return outputClass;
              }}
              className="h-full bg-background react-data-grid-new-table"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default NewTableView;
