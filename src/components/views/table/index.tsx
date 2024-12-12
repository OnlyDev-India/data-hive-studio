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

  const fetchData = async () => {
    setLoading(true);
    const { data } = await getTablesData(currentFile?.tableName || "");
    const { columns } = await getTableColumns(currentFile?.tableName || "");

    if (data) {
      setData(data); // Set fetched data
    }
    if (columns) {
      setColumns(columns);
      dispatch(updateFile({ tableData: { columns, rows: data || [] } }));
    } // Set fetched columns
    setLoading(false);
  };

  useEffect(() => {
    if (currentFile?.tableName) {
      const tableData = currentFile?.tableData;
      if (!tableData) fetchData();
      else {
        setData(tableData.rows);
        setColumns(tableData.columns);
      }
    }
  }, [currentFile?.tableName]);
  // console.log(currentFile);

  return (
    <>
      {loading ? (
        <div className="h-full w-full flex items-center justify-center gap-2">
          <LoaderCircleIcon className="animate-spin text-primary" />
          <p>Fetching...</p>
        </div>
      ) : (
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
          />
        )
      )}
    </>
  );
};

export default TableView;
