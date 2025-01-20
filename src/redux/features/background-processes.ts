import { createSlice } from "@reduxjs/toolkit";

const initialState: any = {
  processes: [],
  completedProcesses: [],
};
export const backgroundProcessesSlice = createSlice({
  name: "db",
  initialState,
  reducers: {
    resetBgProcess: (state) => {
      state = initialState;
    },
    addBgProcess: (state, action) => {
      // check if the process already exists then update
      const index = state.processes.findIndex(
        (process: any) => process.id === action.payload.id,
      );
      if (index !== -1) {
        const updatedSubProcess = [
          ...(state.processes[index].subProcesses || []),
          ...(action.payload.subProcesses || []),
        ];
        state.processes[index] = {
          ...state.processes[index],
          ...action.payload,
          subProcesses: updatedSubProcess,
        };
      } else {
        state.processes.push(action.payload);
      }
    },
    updateBgProcess: (state, action) => {
      const index = state.processes.findIndex(
        (process: any) => process.id === action.payload.id,
      );
      const updatedSubProcess = [
        ...(state.processes[index].subProcesses || []),
        ...(action.payload.subProcesses || []),
      ];
      state.processes[index] = {
        ...state.processes[index],
        ...action.payload,
        subProcesses: updatedSubProcess,
      };
    },
    moveToCompleted: (state, action) => {
      const index = state.processes.findIndex(
        (process: any) => process.id === action.payload.id,
      );
      if (index !== -1) {
        state.completedProcesses.push(state.processes[index]);
        state.processes.splice(index, 1);
      }
    },
    removeBgProcess: (state, action) => {
      state.processes = state.processes.filter(
        (process: any) => process.id !== action.payload.id,
      );
    },
  },
});

export const {
  addBgProcess,
  removeBgProcess,
  resetBgProcess,
  updateBgProcess,
  moveToCompleted,
} = backgroundProcessesSlice.actions;

export default backgroundProcessesSlice.reducer;
