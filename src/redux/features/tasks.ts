import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface Task {
  id: string;
  name: string;
  status: TaskStatus;
  progress: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
  result?: any;
}

interface TasksState {
  tasks: Task[];
}

const initialState: TasksState = {
  tasks: [],
};

const tasksSlice = createSlice({
  name: "tasks",
  initialState,
  reducers: {
    addTask: (state, action: PayloadAction<Omit<Task, 'status' | 'progress' | 'createdAt'>>) => {
      const newTask: Task = {
        ...action.payload,
        status: "pending",
        progress: 0,
        createdAt: new Date().toISOString(),
      };
      state.tasks.push(newTask);
    },
    updateTask: (state, action: PayloadAction<Partial<Task> & { id: string }>) => {
      const taskIndex = state.tasks.findIndex(t => t.id === action.payload.id);
      if (taskIndex !== -1) {
        const task = state.tasks[taskIndex];
        Object.assign(task, action.payload);
        if (task.status === 'completed' || task.status === 'failed') {
          task.completedAt = new Date().toISOString();
        }
      }
    },
    removeTask: (state, action: PayloadAction<string>) => {
      state.tasks = state.tasks.filter(t => t.id !== action.payload);
    },
    clearCompletedTasks: (state) => {
      state.tasks = state.tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
    },
  },
});

export const { addTask, updateTask, removeTask, clearCompletedTasks } = tasksSlice.actions;

export default tasksSlice.reducer; 