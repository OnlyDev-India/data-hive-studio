"use client";
import React, { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { RootState } from "@/redux/store";
import { Task, removeTask, clearCompletedTasks } from "@/redux/features/tasks";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const statusIcons: any = {
  pending: <LoaderCircleIcon className="size-3 animate-pulse text-muted-foreground" />,
  running: <LoaderCircleIcon className="size-3 animate-spin text-primary" />,
  completed: <CheckCheckIcon className="size-3 text-green-500" />,
  failed: <AlertTriangleIcon className="size-3 text-red-500" />,
};

const BottomBar = () => {
  const tasks = useSelector((state: RootState) => state.tasks.tasks);
  const dispatch = useDispatch();

  const activeTasks = tasks.filter(
    (task: Task) => task.status === "pending" || task.status === "running",
  );

  const completedTasks = tasks.filter(
    (task: Task) => task.status === "completed" || task.status === "failed",
  );

  useEffect(() => {
    // Show notifications for newly completed tasks
    completedTasks.forEach((task: Task) => {
      // Removed toast notifications - only show in bottom bar notifications
    });
  }, [completedTasks]);

  return (
    <div className="flex h-[var(--bottom-nav-height)] items-center justify-between bg-secondary px-4 text-xs">
      <div />
      <div className="h-full">
        {activeTasks.map((task: Task) => (
          <Button
            key={task.id}
            variant="ghost"
            className="h-full gap-1 rounded-none p-0 px-2 text-xs font-light hover:bg-popover"
          >
            {statusIcons[task.status]}
            {task.name}
            {task.status === "running" && task.progress > 0 && (
              <span className="text-muted-foreground">({task.progress}%)</span>
            )}
            {task.status === "pending" && (
              <span className="text-muted-foreground">(queued)</span>
            )}
          </Button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-full gap-1 rounded-none p-0 px-2 text-xs font-light hover:bg-popover"
            >
              <BellIcon className={cn("size-3", completedTasks.length > 0 && "fill-primary stroke-primary")} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="top"
            className="min-w-[300px] p-0 text-sm"
          >
            <div className="flex items-center justify-between bg-secondary p-2">
              <span className="text-muted-foreground">Notifications</span>
              <Button
                variant={"ghost"}
                size={"icon"}
                className="size-6 p-0 [&>svg]:size-2"
                onClick={() => dispatch(clearCompletedTasks())}
              >
                <ListXIcon />
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {completedTasks.map((task: Task) => (
                <div
                  key={task.id}
                  className="flex w-full items-start justify-between p-2"
                >
                  <div className="flex flex-col gap-2">
                    <p className="flex items-center gap-2">
                      {statusIcons[task.status]}
                      {task.name}
                    </p>
                    {task.result && (
                      <span className="text-muted-foreground">
                        {task.result}
                      </span>
                    )}
                    {task.error && (
                      <span className="text-destructive">{task.error}</span>
                    )}
                  </div>
                  <Button
                    variant={"ghost"}
                    size={"icon"}
                    className="size-6 p-0 [&>svg]:size-2"
                    onClick={() => dispatch(removeTask(task.id))}
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
