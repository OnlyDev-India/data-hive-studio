import { CustomTabList } from "@/components/common/custom-tab";
import ShortcutGrid from "@/components/common/shortcut-grids";
import Table from "@/components/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import QueryExecutingAnimation from "@/components/ui/query-executing-animation";
import { Tabs } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  removeOutputTab,
  resetQuery,
  setCurrentOutputTab,
} from "@/redux/features/query";
import { RootState } from "@/redux/store";
import { ListXIcon, TriangleAlertIcon } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

const OutputTerminal = ({ dbType }: { dbType: string }) => {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);

  const dispatch = useDispatch();
  const { outputTabs, currentOutputTab } = useSelector(
    (state: RootState) => state.query,
  );

  const handleClearOutput = () => {
    dispatch(resetQuery());
  };

  useEffect(() => {
    if (currentOutputTab && !currentOutputTab.executingQuery) {
      const { data }: any = currentOutputTab.output;
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
      } else {
        setData([]);
        setColumns([]);
      }
    } else {
      setData([]);
      setColumns([]);
    }
  }, [currentOutputTab]);

  const handleTabChange = (value: string) => {
    dispatch(setCurrentOutputTab({ id: value }));
  };
  const handleTabClose = (value: string) => {
    dispatch(removeOutputTab({ id: value }));
  };

  return (
    <div className="h-full w-full rounded-lg bg-secondary">
      <div className="no-scrollbar mx-2 flex items-center justify-between border-b border-border">
        {outputTabs.length > 0 ? (
          <Tabs className="w-full">
            <CustomTabList
              tabs={outputTabs.map((tab) => ({
                label: tab.name,
                value: tab.id,
              }))}
              activeTab={currentOutputTab?.id || ""}
              className="border-none"
              onTabChange={handleTabChange}
              onTabClose={handleTabClose}
              children={
                <div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={"outline"}
                        size={"icon"}
                        onClick={handleClearOutput}
                        className="h-7 w-7 border-border [&_svg]:size-3"
                      >
                        <ListXIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Clear</TooltipContent>
                  </Tooltip>
                </div>
              }
            />
          </Tabs>
        ) : (
          <div className="flex h-[var(--tabs-height)] w-full items-center">
            No Output
          </div>
        )}
      </div>
      {currentOutputTab?.executingQuery ? (
        <div className="flex h-full items-center justify-center overflow-auto p-4">
          <QueryExecutingAnimation className="h-full" size={64} />
        </div>
      ) : columns.length > 0 ? (
        <div className="h-[calc(100%-2.8rem)]">
          {/* TODO: */}
          <Table data={data} columns={columns} dbType={dbType} />
        </div>
      ) : currentOutputTab?.output?.error ? (
        <div className="h-full overflow-auto p-4">
          <Alert className="bg-secondary">
            <TriangleAlertIcon className="h-4 w-4 stroke-red-500" />
            <AlertTitle>Error!</AlertTitle>
            <AlertDescription>{currentOutputTab.output.error}</AlertDescription>
          </Alert>
        </div>
      ) : currentOutputTab?.output?.message ? (
        <div className="h-full overflow-auto p-4">
          <p className="rounded-lg border-2 bg-secondary/60 p-4">
            Message :{" "}
            <span className="text-primary">
              {currentOutputTab.output.message}
            </span>
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
