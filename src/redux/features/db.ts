import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  db: null as any | null,
};
export const dbSlice = createSlice({
  name: "db",
  initialState,
  reducers: {
    resetDb: (state) => {
      state = initialState;
    },
    setDb: (state, action) => {
      state.db = action.payload;
    },
  },
});

export const { setDb, resetDb } = dbSlice.actions;

export default dbSlice.reducer;
