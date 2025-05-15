"use client";
import useBgProcess from "@/hooks/use-bgProcess";
import React, { useEffect } from "react";
import { Button } from "../ui/button";
import {
  AlertTriangleIcon,
  BellIcon,
  CheckCheckIcon,
  ListXIcon,
  LoaderCircleIcon,
  XIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

const statusIcons: any = {
  running: <LoaderCircleIcon className="size-3 animate-spin" />,
  completed: <CheckCheckIcon className="size-3" />,
  failed: <AlertTriangleIcon className="size-3 animate-spin" />,
};

const BottomBar = () => {
  const {
    processes,
    completedProcesses,
    moveToCompleted,
    removeCompletedProcess,
    clearCompletedProcesses,
  } = useBgProcess();

  useEffect(() => {
    if (!processes) return;

    processes.forEach((process: any) => {
      if (process.status === "completed") {
        // TODO: show notification and remove timeout
        setTimeout(() => {
          moveToCompleted({ ...process });
        }, 3000);
      }
    });
  }, [processes]);

  return (
    <div className="flex h-[var(--bottom-nav-height)] items-center justify-between bg-secondary px-4 text-xs">
      <div />
      <div className="h-full">
        {processes?.map((process: any) => (
          <Button
            key={process.id}
            variant="ghost"
            className="h-full gap-1 rounded-none p-0 px-2 text-xs font-light hover:bg-popover"
          >
            {statusIcons[process.status]}
            {process.name}
          </Button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-full gap-1 rounded-none p-0 px-2 text-xs font-light hover:bg-popover"
            >
              <BellIcon className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="top"
            className="min-w-[300px] p-0 text-sm"
          >
            <div className="flex items-center justify-between bg-secondary p-2">
              <span className="text-muted-foreground">Notification</span>
              <Button
                variant={"ghost"}
                size={"icon"}
                className="size-6 p-0 [&>svg]:size-2"
                onClick={clearCompletedProcesses}
              >
                <ListXIcon />
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {completedProcesses?.map((process: any, index: number) => (
                <div
                  key={index}
                  className="flex w-full items-start justify-between p-2"
                >
                  <div className="flex flex-col gap-2">
                    <p className="flex items-center gap-2">
                      {statusIcons.completed}
                      {process.name}
                    </p>
                    {process.subProcesses.length > 0 &&
                      process.subProcesses.map(
                        (subProcess: any, index: number) => (
                          <span key={index} className="text-muted-foreground">
                            {subProcess.details}
                          </span>
                        ),
                      )}
                  </div>
                  <Button
                    variant={"ghost"}
                    size={"icon"}
                    className="size-6 p-0 [&>svg]:size-2"
                    onClick={() => removeCompletedProcess(process)}
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

export default BottomBar;
