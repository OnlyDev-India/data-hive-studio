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
      // TODO:fix this subProcess is not moving to existing completedProcesses
      const index = state.processes.findIndex(
        (process: any) => process.id === action.payload.id,
      );
      const completedIndex = state.completedProcesses.findIndex(
        (process: any) => process.id === action.payload.id,
      );
      if (index !== -1) {
        if (completedIndex === -1) {
          state.completedProcesses.push(state.processes[index]);
        } else {
          const childProcesses =
            state.completedProcesses[completedIndex].subProcesses;
          state.completedProcesses[completedIndex] = {
            ...state.completedProcesses[completedIndex],
            subProcesses: [...childProcesses, action.payload.subProcesses],
          };
        }
        state.processes.splice(index, 1);
      }
    },
    removeBgProcess: (state, action) => {
      state.processes = state.processes.filter(
        (process: any) => process.id !== action.payload.id,
      );
    },
    clearCompletedProcesses: (state) => {
      state.completedProcesses = [];
    },
    removeCompletedProcess: (state, action) => {
      state.completedProcesses = state.completedProcesses.filter(
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
  clearCompletedProcesses,
  removeCompletedProcess,
} = backgroundProcessesSlice.actions;

export default backgroundProcessesSlice.reducer;
