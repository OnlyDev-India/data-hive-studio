"use client";
import React from "react";
import { Button } from "../ui/button";
import {
  ClipboardXIcon,
  HardDriveUploadIcon,
  LoaderIcon,
  Trash2Icon,
} from "lucide-react";
import { deleteTableData, updateTable } from "@/lib/actions/fetch-data";
import { toast } from "sonner";
import { useDispatch, useSelector } from "react-redux";
import { updateFile } from "@/redux/features/open-files";
interface Row {
  [key: string]: any; // Dynamic data rows
}
interface FloatingActionsProps {
  selectedRows?: number[];
  changedRows?: { [key: number]: { old: Row; new: Row } };
  tableName: string;
  updatedRows?: Row[];
  handleUpdateTableChanges?: (type: string) => void;
}

const FloatingActions = ({
  selectedRows,
  changedRows,
  updatedRows,
  tableName,
  handleUpdateTableChanges,
}: FloatingActionsProps) => {
  const [loading, setLoading] = React.useState<"updating" | "deleting" | null>(
    null
  );
  const { currentFile } = useSelector((state: any) => state.openFiles);
  const dispatch = useDispatch();
  const handleUpdateChanges = async () => {
    if (!changedRows) return;
    setLoading("updating");
    const changedData = Object.values(changedRows).map((row) => ({
      oldValue: row.old,
      newValue: row.new,
    }));
    const response = await updateTable(tableName, changedData);

    if (response.effectedRows) {
      toast.success(`Updated ${response.effectedRows} rows`);
      handleUpdateTableChanges?.("update");
      dispatch(
        updateFile({
          id: currentFile?.id,
          tableData: {
            columns: currentFile?.tableData?.columns,
            rows: JSON.parse(response.data),
          },
        })
      );
    }

    setLoading(null);
  };

  const handleDeleteRows = async () => {
    if (!selectedRows) return;
    setLoading("deleting");
    const deletingRows = updatedRows?.filter((_, index) =>
      selectedRows.includes(index)
    );
    if (!deletingRows) return;
    const response = await deleteTableData(tableName, deletingRows);
    console.log(response);

    // if (response.effectedRows) {
    toast.success(`Deleted ${response.effectedRows} rows`);
    handleUpdateTableChanges?.("delete");
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableData: {
          columns: currentFile?.tableData?.columns,
          rows: JSON.parse(response.data),
        },
      })
    );
    setLoading(null);
  };

  const handleDiscardChanges = () => {
    handleUpdateTableChanges?.("discard");
  };

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10">
      <div className="bg-popover px-6 py-2 rounded-lg shadow-md flex items-center gap-2">
        {selectedRows && selectedRows.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground whitespace-nowrap">
              {selectedRows.length} Selected:
            </p>
            <Button
              variant={"ghost"}
              className="text-white px-2 hover:bg-red-500/30 hover:text-red-500 h-7"
              onClick={handleDeleteRows}
              disabled={loading?true:false}
            >
              <Trash2Icon /> Delete
            </Button>
          </>
        )}
        {changedRows && Object.keys(changedRows).length > 0 && (
          <>
            <p className="text-sm text-muted-foreground whitespace-nowrap">
              {Object.keys(changedRows).length} Changed:
            </p>
            <Button
              variant={"ghost"}
              className="text-white px-2 h-7"
              onClick={handleUpdateChanges}
              disabled={loading?true:false}
            >
              {loading === "updating" ? (
                <LoaderIcon className="animate-spin" />
              ) : (
                <HardDriveUploadIcon />
              )}{" "}
              Apply
            </Button>
            <Button
              variant={"ghost"}
              className="text-white px-2 h-7"
              onClick={handleDiscardChanges}
              disabled={loading?true:false}
            >
              <ClipboardXIcon />
              Discard All Changes
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default FloatingActions;
