import { getTableColumns, getTablesData } from "@/lib/actions/fetch-data";
import { useEffect, useState } from "react";
import Table from "../../table";
import { useDispatch, useSelector } from "react-redux";
import { updateFile } from "@/redux/features/open-files";
import { FileTableType, RefetchType } from "@/types/file.type";
import { toast } from "sonner";

const TableView = () => {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [loading, setLoading] = useState<RefetchType>(null);
  const { currentFile }: { currentFile: FileTableType } = useSelector(
    (state: any) => state.openFiles,
  );
  const dispatch = useDispatch();

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

    if (
      tableFilter &&
      tableFilter.applyFilter &&
      tableFilter.filter.newFilter.length > 0
    ) {
      const { filter } = tableFilter;
      if (!filter) return;

      if (JSON.stringify(filter.oldFilter) === JSON.stringify(filter.newFilter))
        return;
      setLoading(loadingState);

      const oldFilter = filter.newFilter.filter((item: any) => item.value);

      // All logic will Go here to fetch the data with the query
      const { columns } = await getTableColumns(tableName || "");
      const { data, totalRecords } = await getTablesData(tableName, {
        filters: filter.newFilter,
        orderBy: tableOrder,
        pagination,
      });

      if (columns && data) {
        const rows = ((await JSON.parse(data || "")) || []).map((item: any) => {
          const copiedItem = JSON.parse(JSON.stringify(item));
          Object.keys(item).forEach((key) => {
            if (typeof item[key] === "object")
              copiedItem[key] = item[key]?.toString();
          });
          return copiedItem;
        });

        dispatch(
          updateFile({
            id: currentFile.id,
            tableRefetch: null,
            tableData: {
              columns: columns?.map(
                (col: { column_name: any; data_type: any; key_type: any }) => ({
                  key: col.column_name,
                  name: col.column_name,
                  data_type: col.data_type,
                  key_type: col.key_type,
                }),
              ),
              rows,
              totalRecords,
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
        toast.error("Failed to Apply filter");
      }
      setLoading(null);
    } else {
      // this executes when there is no filter applied
      setLoading(loadingState);
      const { columns } = await getTableColumns(tableName || "");
      const { data, totalRecords } = await getTablesData(tableName || "", {
        orderBy: tableOrder,
        pagination,
      });

      if (columns && data) {
        const rows = ((await JSON.parse(data || "")) || []).map((item: any) => {
          const copiedItem = JSON.parse(JSON.stringify(item));
          Object.keys(item).forEach((key) => {
            if (typeof item[key] === "object")
              copiedItem[key] = item[key]?.toString();
          });
          return copiedItem;
        });
        dispatch(
          updateFile({
            id: currentFile.id,
            tableRefetch: null,
            tableData: {
              columns: columns?.map(
                (col: { column_name: any; data_type: any; key_type: any }) => ({
                  key: col.column_name,
                  name: col.column_name,
                  data_type: col.data_type,
                  key_type: col.key_type,
                }),
              ),
              rows,
              totalRecords,
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
    setLoading(null);
  };

  useEffect(() => {
    if (currentFile.tableName) {
      const tableColumns = currentFile.tableData.columns;
      if (tableColumns.length < 1 || currentFile.tableFilter.applyFilter)
        fetchData();
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
      <Table
        data={data}
        columns={columns}
        refetchData={fetchData}
        isFetching={loading}
      />
    )
  );
};

export default TableView;
