import { FileTableType, PaginationType, RefetchType } from "@/types/file.type";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
} from "lucide-react";
import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { Input } from "../ui/input";
import { updateFile } from "@/redux/features/open-files";
import { Button } from "../ui/button";
import { useDebouncedCallback } from "@/hooks/debounce";

interface PaginationProps {
  isFetching?: RefetchType;
}

const Pagination = ({ isFetching }: PaginationProps) => {
  const { currentFile }: { currentFile: FileTableType } = useSelector(
    (state: any) => state.openFiles,
  );

  const dispatch = useDispatch();

  const totalRecords = currentFile?.tableData?.totalRecords || 0;
  const currentRecords = currentFile?.tableData?.rows.length || 0;
  const tablePagination = currentFile?.tablePagination || {
    page: 1,
    limit: 10,
  };
  const [pagination, setPagination] = useState<PaginationType>(tablePagination);
  const totalPages = Math.ceil(totalRecords / tablePagination.limit);

  const handleInputValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = isNaN(+parseInt(e.target.value))
      ? 0
      : +parseInt(e.target.value);
    if (e.target.name == "page" && value > totalPages) value = totalPages || 1;
    const newPagination = { ...pagination, [e.target.name]: value };
    setPagination(newPagination);
    debouncedHandleInputValueChange(
      newPagination,
      "pagination:" + e.target.name + ":" + value,
    );
  };

  const debouncedHandleInputValueChange = useDebouncedCallback(
    (pagination, tableRefetch) => {
      console.log(pagination, tableRefetch);

      dispatch(
        updateFile({
          id: currentFile?.id,
          tablePagination: {
            ...pagination,
          },
          tableRefetch,
        }),
      );
    },
    500,
  );

  const handlePageChange = (page: number) => {
    if (page > totalPages) page = totalPages || 1;
    if (page < 1) page = 1;
    setPagination({ ...pagination, page });
    dispatch(
      updateFile({
        id: currentFile?.id,
        tablePagination: {
          ...currentFile?.tablePagination,
          page,
        },
        tableRefetch: "pagination:page:" + page,
      }),
    );
  };

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {currentFile?.tableName && (
          <>
            {isFetching !== null ? (
              <LoaderCircleIcon
                className="animate-spin text-muted-foreground"
                size={12}
              />
            ) : (
              <span>{currentRecords} : </span>
            )}
            {totalRecords} row{totalRecords > 0 && "s"}
          </>
        )}
      </span>

      {currentFile.tableName && (
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Input
                name="limit"
                placeholder=""
                className="h-7 w-10 border border-border bg-secondary px-1 py-0 text-center !text-xs"
                defaultValue={tablePagination?.limit}
                onChange={handleInputValueChange}
              />
            </TooltipTrigger>
            <TooltipContent className="!text-xs">Limit</TooltipContent>
          </Tooltip>
          <div className="flex items-center rounded-md border border-border">
            <Button
              variant={"ghost"}
              size={"icon"}
              className="h-7 w-7 border-border [&_svg]:size-3"
              onClick={() => handlePageChange(tablePagination.page - 1)}
              disabled={tablePagination.page === 1}
            >
              <ChevronLeftIcon />
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Input
                  name="page"
                  placeholder=""
                  className="h-7 w-10 rounded-none border-0 border-x border-border bg-secondary px-1 py-0 text-center !text-xs"
                  value={pagination?.page}
                  onChange={handleInputValueChange}
                />
              </TooltipTrigger>
              <TooltipContent className="!text-xs">Page</TooltipContent>
            </Tooltip>
            <Button
              variant={"ghost"}
              size={"icon"}
              onClick={() => handlePageChange(tablePagination.page + 1)}
              className="h-7 w-7 border-border opacity-80 hover:opacity-100 [&_svg]:size-3"
              disabled={tablePagination.page === totalPages}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Pagination;
