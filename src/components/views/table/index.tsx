import { getTableColumns, getTablesData } from "@/lib/actions/fetch-data";
import { useEffect, useState } from "react";
import Table from "../../table";
import { useDispatch, useSelector } from "react-redux";
import { updateFile } from "@/redux/features/open-files";
import { FileTableType, RefetchType } from "@/types/file.type";
import { toast } from "sonner";

interface TableDataResponse {
  data: any[];
  error: string | null;
  totalRecords: number;
  columns: Array<{
    name: string;
    type: string;
    default: string | null;
    nullable: boolean;
    maxLength: number | null;
    precision: number | null;
    scale: number | null;
    constraint: string | null;
    foreignTable: string | null;
    foreignColumn: string | null;
  }>;
}

const TableView = ({ dbType }: { dbType: string }) => {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [loading, setLoading] = useState<RefetchType>(null);
  const { currentFile }: { currentFile: FileTableType } = useSelector(
    (state: any) => state.openFiles,
  );
  const dispatch = useDispatch();

  const processColumnData = (columns: any[]) => {
    return columns.map((col) => ({
      key: col.column_name,
      name: col.column_name,
      data_type: col.data_type,
      key_type: col.key_type,
      nullable: col.is_nullable === 'YES',
      default: col.column_default,
      maxLength: col.character_maximum_length,
      precision: col.numeric_precision,
      scale: col.numeric_scale,
      foreignTable: col.foreign_table_name,
      foreignColumn: col.foreign_column_name,
      enum_values: col.enum_values,
      is_enum: col.is_enum,
      tooltip: `${col.column_name} (${col.data_type})${col.is_nullable === 'YES' ? ' - Nullable' : ''}${col.column_default ? ` - Default: ${col.column_default}` : ''}${col.foreign_table_name ? ` - References: ${col.foreign_table_name}.${col.foreign_column_name}` : ''}`,
    }));
  };

  const processRowData = (rows: any[]) => {
    return rows.map((item: any) => {
      const copiedItem = JSON.parse(JSON.stringify(item));
      Object.keys(item).forEach((key) => {
        if (!Array.isArray(item[key]) && typeof item[key] === "object") {
          copiedItem[key] = item[key]?.toString();
        }
      });
      return copiedItem;
    });
  };

  const fetchData = async () => {
    if (!currentFile) return;
    const tableName = currentFile.tableName;
    if (!tableName) return;
    const tableFilter = currentFile.tableFilter;
    const tableOrder = currentFile.tableOrder;
    const tableRefetch = currentFile.tableRefetch;
    const pagination = currentFile.tablePagination;

    const loadingState = tableFilter.applyFilter
      ? "filter"
      : tableRefetch || "fetch";

    try {
      setLoading(loadingState);
      if (
        tableFilter &&
        tableFilter.applyFilter &&
        tableFilter.filter.newFilter.length > 0
      ) {
        const { filter } = tableFilter;
        if (!filter) return;

        if (
          JSON.stringify(filter.oldFilter) === JSON.stringify(filter.newFilter)
        )
          return;

        const oldFilter = filter.newFilter.filter((item: any) => item.value);

        const { data, totalRecords } = await getTablesData(tableName, {
          filters: filter.newFilter,
          orderBy: tableOrder,
          pagination,
        });

        const { columns } = await getTableColumns(tableName || "");
        if (columns) {
          const processedColumns = processColumnData(
            columns as TableDataResponse["columns"],
          );
          const parsedData = data ? JSON.parse(data) : [];
          const processedRows = processRowData(
            Array.isArray(parsedData) ? parsedData : [],
          );

          dispatch(
            updateFile({
              id: currentFile.id,
              tableRefetch: null,
              tableData: {
                columns: processedColumns,
                rows: processedRows,
                totalRecords:
                  typeof parseInt(totalRecords) === "number"
                    ? parseInt(totalRecords)
                    : 0,
              },
              tableFilter: {
                ...tableFilter,
                filter: {
                  oldFilter: oldFilter,
                  newFilter: filter.newFilter,
                },
                applyFilter: false,
              },
            }),
          );
        } else {
          toast.error("Failed to apply filter");
        }
      } else {
        const { data, totalRecords } = await getTablesData(tableName, {
          orderBy: tableOrder,
          pagination,
        });
        const { columns } = await getTableColumns(tableName || "");
        if (columns) {
          const processedColumns = processColumnData(
            columns as TableDataResponse["columns"],
          );
          const parsedData = data ? JSON.parse(data) : [];
          const processedRows = processRowData(
            Array.isArray(parsedData) ? parsedData : [],
          );

          dispatch(
            updateFile({
              id: currentFile.id,
              tableRefetch: null,
              tableData: {
                columns: processedColumns,
                rows: processedRows,
                totalRecords:
                  typeof parseInt(totalRecords) === "number"
                    ? parseInt(totalRecords)
                    : 0,
              },
              tableFilter: {
                ...tableFilter,
                filter: {
                  oldFilter: [],
                  newFilter: [],
                },
                applyFilter: false,
              },
            }),
          );
        }
      }
    } catch (error) {
      toast.error("Failed to fetch table data");
      console.error("Error fetching table data:", error);
    } finally {
      setLoading(null);
    }
  };

  useEffect(() => {
    if (currentFile.tableName) {
      const tableColumns = currentFile.tableData?.columns;
      if (
        !tableColumns ||
        tableColumns.length < 1 ||
        currentFile.tableFilter.applyFilter
      ) {
        fetchData();
      }
    }
  }, [currentFile.tableName, currentFile.tableFilter.applyFilter]);

  useEffect(() => {
    if (!currentFile.tableRefetch) return;
    fetchData();
  }, [currentFile.tableRefetch]);

  useEffect(() => {
    if (currentFile.tableName) {
      const tableData = currentFile.tableData;
      if (tableData) {
        setData(tableData.rows);
        setColumns(tableData.columns);
      }
    }
  }, [currentFile.tableData?.rows, currentFile.tableData?.columns]);

  return (
    columns &&
    data && (
      <div className="h-[calc(100%-2.6rem)] overflow-hidden rounded-b-lg bg-secondary">
        <Table
          data={data}
          columns={columns}
          refetchData={fetchData}
          isFetching={loading}
          dbType={dbType}
        />
      </div>
    )
  );
};

export default TableView;
