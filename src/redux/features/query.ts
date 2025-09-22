import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface OutputTab {
  id: string;
  name: string;
  type: string;
  output: any | null;
  executingQuery: boolean;
}

interface OutputTabState {
  outputTabs: OutputTab[];
  currentOutputTab: OutputTab | null;
  // queryOutput: any | null;
  // executingQuery: boolean;
}

const initialState: OutputTabState = {
  outputTabs: [],
  currentOutputTab: null,
  // queryOutput: null as any | null,
  // executingQuery: false,
};

export const querySlice = createSlice({
  name: "Query",
  initialState,
  reducers: {
    resetQuery: (state) => {
      state.outputTabs = initialState.outputTabs;
      state.currentOutputTab = initialState.currentOutputTab;
      // state.queryOutput = initialState.queryOutput;
      // state.executingQuery = initialState.executingQuery;
    },
    updateQueryOutput: (
      state,
      action: PayloadAction<{
        id: string;
        output: any;
      }>,
    ) => {
      const id = action.payload.id;
      const index = state.outputTabs.findIndex((tab) => tab.id === id);
      if (index !== -1) {
        state.outputTabs[index].output = action.payload.output;
        state.outputTabs[index].executingQuery = false;
      }
      if(state.currentOutputTab?.id === id){
        state.currentOutputTab.output = action.payload.output;
        state.currentOutputTab.executingQuery = false;
      }
    },
    setQueryExecution: (
      state,
      action: PayloadAction<{ id: string; executingQuery: boolean }>,
    ) => {
      const id = action.payload.id;
      const index = state.outputTabs.findIndex((tab) => tab.id === id);
      if (index !== -1) {
        state.outputTabs[index].executingQuery = action.payload.executingQuery;
      } else {
        const currentOutputTab = {
          id,
          name: "Output-" + (state.outputTabs.length + 1),
          type: "output",
          output: null,
          executingQuery: action.payload.executingQuery,
        };
        state.outputTabs.push(currentOutputTab);
        state.currentOutputTab = currentOutputTab;
      }
    },
    setCurrentOutputTab: (state, action: PayloadAction<{ id: string }>) => {
      const id = action.payload.id;
      state.currentOutputTab =
        state.outputTabs.find((tab) => tab.id === id) || null;
    },
    removeOutputTab: (state, action: PayloadAction<{ id: string }>) => {
      const id = action.payload.id;
      state.outputTabs = state.outputTabs.filter((tab) => tab.id !== id);
      if (state.currentOutputTab?.id === id) {
        if (state.outputTabs.length > 0) {
          state.currentOutputTab =
            state.outputTabs[state.outputTabs.length - 1];
        } else {
          state.currentOutputTab = null;
        }
      }
    },
  },
});

export const {
  updateQueryOutput,
  setQueryExecution,
  resetQuery,
  setCurrentOutputTab,
  removeOutputTab,
} = querySlice.actions;

export default querySlice.reducer;
