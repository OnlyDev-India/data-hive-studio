"use client";
import { useSelector, useDispatch } from "react-redux";
import { RootState } from "@/redux/store";
import { Task, removeTask, clearCompletedTasks } from "@/redux/features/tasks";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { XIcon, Trash2Icon } from "lucide-react";

const TaskProgress = () => {
  const tasks = useSelector((state: RootState) => state.tasks.tasks);
  const dispatch = useDispatch();

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-background border rounded-lg shadow-lg p-4 z-50">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-semibold">Background Tasks</h3>
        <Button variant="ghost" size="sm" onClick={() => dispatch(clearCompletedTasks())}>
          <Trash2Icon className="h-4 w-4 mr-2" />
          Clear Completed
        </Button>
      </div>
      <div className="space-y-4">
        {tasks.map((task: Task) => (
          <div key={task.id} className="p-2 rounded-md border">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">{task.name}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => dispatch(removeTask(task.id))}>
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-1">
              <Progress value={task.progress} className="h-2" />
              <div className="text-xs text-muted-foreground mt-1">
                {task.status === 'running' && `Running... ${task.progress}%`}
                {task.status === 'completed' && 'Completed'}
                {task.status === 'failed' && `Failed: ${task.error}`}
                {task.status === 'pending' && 'Pending...'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TaskProgress; 