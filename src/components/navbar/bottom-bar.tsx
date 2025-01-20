"use client";
import useBgProcess from "@/hooks/use-bgProcess";
import React, { useEffect } from "react";
import { Button } from "../ui/button";
import {
  AlertTriangleIcon,
  CheckCheckIcon,
  LoaderCircleIcon,
} from "lucide-react";

const statusIcons: any = {
  running: <LoaderCircleIcon className="size-3 animate-spin" />,
  completed: <CheckCheckIcon className="size-3" />,
  failed: <AlertTriangleIcon className="size-3 animate-spin" />,
};

const BottomBar = () => {
  const { processes, moveToCompleted } = useBgProcess();

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
    <div className="flex h-[var(--bottom-nav-height)] items-center justify-between border-t border-border px-4 text-xs">
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
      </div>
    </div>
  );
};

export default BottomBar;
