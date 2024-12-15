import { getTableColumns, getTablesData } from "@/lib/actions/fetch-data";
import { useEffect, useState } from "react";
import Table from "../../table";
import { useDispatch, useSelector } from "react-redux";
import { updateFile } from "@/redux/features/open-files";
import { FileType } from "@/types/file.type";

const TableView = () => {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { currentFile }: { currentFile: FileType | null } = useSelector(
    (state: any) => state.openFiles
  );
  const dispatch = useDispatch();

  const fetchData = async () => {
    if (!currentFile) return;
    const tableName = currentFile.tableName;
    if (!tableName) return;
    const tableFilter = currentFile.tableFilter;

    if (tableFilter && tableFilter.applyFilter) {
      const { filter } = tableFilter;
      if (!filter) return;

      if (JSON.stringify(filter.oldFilter) === JSON.stringify(filter.newFilter))
        return;
      setLoading(true);

      const oldFilter = filter.newFilter.filter((item: any) => item.value);

      // All logic will Go here to fetch the data with the query

      dispatch(
        updateFile({
          id: currentFile?.id,
          tableFilter: {
            ...tableFilter,
            filter: {
              oldFilter: oldFilter,
              newFilter: filter.newFilter,
            },
            applyFilter: false,
          },
        })
      );
    } else {
      // this executes when there is no filter applied
      setLoading(true);
      const { data } = await getTablesData(tableName || "");
      const { columns } = await getTableColumns(tableName || "");

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
            id: currentFile?.id,
            tableData: {
              columns,
              rows,
            },
          })
        );
        setData(rows);
        setColumns(columns);
      } // Set fetched columns
    }
    setLoading(false);
  };

  useEffect(() => {
    if (currentFile?.tableName) {
      const tableData = currentFile?.tableData;
      if (!tableData || currentFile?.tableFilter?.applyFilter) fetchData();
      else {
        setData(tableData.rows);
        setColumns(tableData.columns);
      }
    }
  }, [currentFile?.tableName, currentFile?.tableFilter?.applyFilter]);
  // console.log(currentFile);

  // useEffect(() => {
  //   if (currentFile?.tableName) {
  //     const tableData = currentFile?.tableData;
  //     if (tableData) {
  //       setData(tableData.rows);
  //       setColumns(tableData.columns);
  //     }
  //   }
  // }, [currentFile?.tableData?.rows, currentFile?.tableData?.columns]);

  return (
    columns &&
    data && (
      <Table
        data={data}
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
