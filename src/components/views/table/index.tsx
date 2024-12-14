import { getTableColumns, getTablesData } from "@/lib/actions/fetch-data";
import { useEffect, useState } from "react";
import Table from "../../table";
import { LoaderCircleIcon } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { updateFile } from "@/redux/features/open-files";

const TableView = () => {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { currentFile }: { currentFile: FileType | null } = useSelector(
    (state: any) => state.openFiles
  );
  const dispatch = useDispatch();

  const fetchData = async (filter?: { filter: any; applyFilter: boolean }) => {
    setLoading(true);
    console.log(filter);

    const { data } = await getTablesData(currentFile?.tableName || "");
    const { columns } = await getTableColumns(currentFile?.tableName || "");

    if (columns && data) {
      dispatch(
        updateFile({
          id: currentFile?.id,
          tableData: { columns, rows: (await JSON.parse(data || "")) || [] },
        })
      );
    } // Set fetched columns
    if (filter?.applyFilter) {
      dispatch(
        updateFile({
          id: currentFile?.id,
          tableFilter: { filter: filter.filter, applyFilter: false },
        })
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    if (currentFile?.tableName) {
      const tableData = currentFile?.tableData;
      const tableFilter = currentFile?.tableFilter;
      if (tableFilter?.applyFilter) fetchData(tableFilter);
      else if (!tableData) fetchData();
      else {
        setData(tableData.rows);
        setColumns(tableData.columns);
      }
    }
  }, [currentFile?.tableName, currentFile?.tableFilter?.applyFilter]);
  // console.log(currentFile);

  useEffect(() => {
    if (currentFile?.tableName) {
      const tableData = currentFile?.tableData;
      if (tableData) {
        setData(tableData.rows);
        setColumns(tableData.columns);
      }
    }
  }, [currentFile?.tableData]);

  return (
    columns &&
    data && (
      <Table
        data={
          data?.map((item: any) => {
            const copiedItem = JSON.parse(JSON.stringify(item));
            Object.keys(item).forEach((key) => {
              if (typeof item[key] === "object")
                copiedItem[key] = item[key]?.toString();
            });
            return copiedItem;
          }) || []
        }
        columns={columns?.map(
          (col: { column_name: any; data_type: any; key_type: any }) => ({
            key: col.column_name,
            name: col.column_name,
            data_type: col.data_type,
            key_type: col.key_type,
          })
        )}
        refetchData={fetchData}
        isFetching={loading}
      />
    )
  );
};

export default TableView;
