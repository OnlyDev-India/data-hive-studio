import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  queryOutput: null as any | null,
  executingQuery: false,
};

export const querySlice = createSlice({
  name: "Query",
  initialState,
  reducers: {
    resetQuery: (state) => {
      state.queryOutput = initialState.queryOutput;
      state.executingQuery = initialState.executingQuery;
    },
    setQueryOutput: (state, action) => {
      state.queryOutput = JSON.parse(action.payload);
    },
    setExecutingQuery: (state, action) => {
      state.executingQuery = action.payload;
    },
  },
});

export const { setQueryOutput, setExecutingQuery, resetQuery } =
  querySlice.actions;

export default querySlice.reducer;
