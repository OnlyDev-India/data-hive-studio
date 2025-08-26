import store from "@/redux/store";
import { addTask, updateTask, Task } from "@/redux/features/tasks";

const saveFile = async (content: string, filename: string, mimeType: string) => {
  const exportPath = localStorage.getItem("export-path");
  
  if (window.electron && exportPath) {
    // Use Electron's saveFile API with the saved path
    const fullPath = `${exportPath}/${filename}`;
    const result = await window.electron.saveFile(content, fullPath);
    return result;
  } else {
    // Fallback to browser download
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return { success: true, error: undefined };
  }
};

class TaskManager {
  private static instance: TaskManager;
  private worker: Worker | null = null;
  private taskQueue: Task[] = [];
  private isWorkerBusy = false;

  private constructor() {
    this.initWorker();
  }

  private initWorker() {
    try {
      this.worker = new Worker('/task-worker.js');
      this.worker.onmessage = (event) => {
        const { type, task: taskUpdate } = event.data;
        if (type === 'UPDATE') {
          store.dispatch(updateTask(taskUpdate));

          if (taskUpdate.status === 'completed' || taskUpdate.status === 'failed') {
            // Handle export completion
            if (taskUpdate.status === 'completed' && taskUpdate.result && typeof taskUpdate.result === 'object' && taskUpdate.result.data) {
              // This is an export task result
              const { data, fileName, mimeType, rowCount } = taskUpdate.result;
              
              // Save file to the saved path or trigger download
              saveFile(data, fileName, mimeType).then((result) => {
                const message = result.success 
                  ? `Exported ${rowCount} rows to ${fileName}`
                  : `Failed to export: ${result.error || 'Unknown error'}`;
                
                // Update the task result to show success/failure message
                store.dispatch(updateTask({
                  id: taskUpdate.id,
                  result: message,
                  status: result.success ? 'completed' : 'failed',
                  error: result.success ? undefined : result.error
                }));
              });
            }
            
            this.isWorkerBusy = false;
            this.processQueue();
          }
        }
      };
    } catch (error) {
      console.error('Failed to initialize worker:', error);
    }
  }

  public static getInstance(): TaskManager {
    if (!TaskManager.instance) {
      TaskManager.instance = new TaskManager();
    }
    return TaskManager.instance;
  }

  public addTask(taskName: string, payload: any = {}) {
    const id = crypto.randomUUID();
    const task: Omit<Task, 'status' | 'progress' | 'createdAt'> = { id, name: taskName, ...payload };
    
    store.dispatch(addTask(task));
    
    const fullTask = store.getState().tasks.tasks.find((t: Task) => t.id === id);
    if (fullTask) {
        this.taskQueue.push(fullTask);
        this.processQueue();
    }
    return id;
  }

  private processQueue() {
    if (this.isWorkerBusy || this.taskQueue.length === 0 || !this.worker) {
      return;
    }

    this.isWorkerBusy = true;
    const task = this.taskQueue.shift();
    if (task) {
        this.worker.postMessage({ task });
    }
  }
}

export const taskManager = TaskManager.getInstance(); 