"use client";
import React from "react";
import { Button } from "../ui/button";
import {
  BetweenHorizontalStartIcon,
  ClipboardXIcon,
  HardDriveUploadIcon,
  LoaderIcon,
  Trash2Icon,
} from "lucide-react";
import {
  deleteTableData,
  insertTableData,
  updateTable,
} from "@/lib/actions/fetch-data";
import { toast } from "sonner";
import { useDispatch, useSelector } from "react-redux";
import { updateFile } from "@/redux/features/open-files";
import { FileType } from "@/types/file.type";
import DeleteModal from "../modals/delete-modal";
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
  const [loading, setLoading] = React.useState<
    "updating" | "adding" | "deleting" | null
  >(null);
  const { currentFile }: { currentFile: FileType } = useSelector(
    (state: any) => state.openFiles
  );
  const newRows = currentFile?.tableOperations?.insertedRows;
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
      // dispatch(
      //   updateFile({
      //     id: currentFile?.id,
      //     tableData: {
      //       columns: currentFile?.tableData?.columns,
      //       rows: JSON.parse(response.data),
      //     },
      //   })
      // );
    } else if (response.updateError) {
      toast.error(response.updateError);
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
    toast.success(
      `${response.effectedRows} row${
        response.effectedRows > 1 ? "s" : ""
      } Deleted`
    );
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

  const handleInsertRows = async () => {
    if (!newRows || newRows === 0) return;
    if (!currentFile || !currentFile?.tableName) return;
    const insertingRows = currentFile?.tableData?.rows
      .filter((row: any) => row.isNew)
      .map((row: any) => {
        const copiedRow = JSON.parse(JSON.stringify(row));
        delete copiedRow.isNew;
        return Object.fromEntries(
          Object.entries(copiedRow).filter(
            ([_, value]) =>
              value !== null && value !== undefined && value !== ""
          )
        );
      });
    if (!insertingRows || insertingRows.length === 0) return;
    setLoading("adding");

    const response = await insertTableData({
      tableName: currentFile.tableName,
      values: insertingRows,
    });
    if (response.data && response.data !== "null") {
      const newRows = JSON.parse(response.data);
      toast.success(`${newRows?.length} records inserted`);
      handleUpdateTableChanges?.("discard");
      dispatch(
        updateFile({
          id: currentFile?.id,
          tableData: {
            columns: currentFile?.tableData?.columns,
            rows: [
              ...newRows,
              ...currentFile?.tableData?.rows.filter((row: any) => !row.isNew),
            ],
          },
        })
      );
    } else if (response.error) {
      toast.error(response.error);
    }

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
            <DeleteModal description={`${selectedRows.length} rows will be deleted and can't be undone`} onConfirm={handleDeleteRows}>
              <Button
                variant={"ghost"}
                className="text-white px-2 hover:bg-red-500/30 hover:text-red-500 h-7"
                disabled={loading ? true : false}
              >
                {loading === "deleting" ? (
                  <LoaderIcon className="animate-spin" />
                ) : (
                  <Trash2Icon />
                )}{" "}
                Delete
              </Button>
            </DeleteModal>
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
              disabled={loading ? true : false}
            >
              {loading === "updating" ? (
                <LoaderIcon className="animate-spin" />
              ) : (
                <HardDriveUploadIcon />
              )}{" "}
              Apply
            </Button>
          </>
        )}
        {newRows !== null && newRows !== undefined && newRows > 0 && (
          <>
            <p className="text-sm text-muted-foreground whitespace-nowrap">
              {newRows} Added:
            </p>
            <Button
              variant={"ghost"}
              className="text-white px-2 h-7"
              onClick={handleInsertRows}
              disabled={loading ? true : false}
            >
              {loading === "adding" ? (
                <LoaderIcon className="animate-spin" />
              ) : (
                <BetweenHorizontalStartIcon />
              )}{" "}
              Insert
            </Button>
          </>
        )}
        <Button
          variant={"ghost"}
          className="text-white px-2 h-7"
          onClick={handleDiscardChanges}
          disabled={loading ? true : false}
        >
          <ClipboardXIcon />
          Discard All Changes
        </Button>
      </div>
    </div>
  );
};

export default FloatingActions;
