import ShortcutGrid from "@/components/common/shortcut-grids";
import Table from "@/components/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import QueryExecutingAnimation from "@/components/ui/query-executing-animation";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { setQueryOutput } from "@/redux/features/query";
import { ListXIcon, TriangleAlertIcon } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

const OutputTerminal = ({ dbType }: { dbType: string }) => {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);

  const dispatch = useDispatch();
  const { queryOutput, executingQuery } = useSelector(
    (state: any) => state.query,
  );

  const handleClearOutput = () => {
    dispatch(setQueryOutput(null));
  };

  useEffect(() => {
    if (queryOutput) {
      const { data }: any = queryOutput;
      if (data) {
        setData(
          data.rows?.map((item: any) => {
            const copiedItem = JSON.parse(JSON.stringify(item));
            Object.keys(item).forEach((key) => {
              // if (typeof item[key] === "object")
              //   copiedItem[key] = item[key]?.toString();
            });
            return copiedItem;
          }),
        );
        setColumns(
          data.columns?.map((col: { column_name: any; data_type: any }) => ({
            key: col.column_name,
            name: col.column_name,
            data_type: col.data_type,
          })),
        );
      }
    } else {
      setData([]);
      setColumns([]);
    }
  }, [queryOutput]);

  return (
    <div className="h-full w-full rounded-lg bg-secondary">
      <div className="mx-2 flex items-center justify-between border-b border-border px-2 py-1 custom-scrollbar">
        <p>output</p>
        <div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={"ghost"}
                size={"icon"}
                onClick={handleClearOutput}
              >
                <ListXIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {executingQuery ? (
        <div className="flex h-full items-center justify-center overflow-auto p-4">
          <QueryExecutingAnimation className="h-full" size={64} />
        </div>
      ) : columns.length > 0 ? (
        <div className="h-[calc(100%-2.8rem)]">
          {/* TODO: */}
          <Table data={data} columns={columns} dbType={dbType} />
        </div>
      ) : queryOutput?.error ? (
        <div className="h-full overflow-auto p-4">
          <Alert className="bg-secondary">
            <TriangleAlertIcon className="h-4 w-4 stroke-red-500" />
            <AlertTitle>Error!</AlertTitle>
            <AlertDescription>{queryOutput.error}</AlertDescription>
          </Alert>
        </div>
      ) : queryOutput?.message ? (
        <div className="h-full overflow-auto p-4">
          <p className="rounded-lg border-2 bg-secondary/60 p-4">
            Message :{" "}
            <span className="text-primary">{queryOutput.message}</span>
          </p>
        </div>
      ) : (
        <div className="h-[calc(100%-2.7rem)] overflow-auto p-4">
          <ShortcutGrid />
        </div>
      )}
    </div>
  );
};

export default OutputTerminal;
