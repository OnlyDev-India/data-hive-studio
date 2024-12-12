import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  editor: null as any | null,
};
export const editorSlice = createSlice({
  name: "Editor",
  initialState,
  reducers: {
    resetEditor: (state) => {
      state.editor = initialState.editor;
    },
    setEditor: (state, action) => {
      state.editor = action.payload;
    },
  },
});

export const { setEditor, resetEditor } = editorSlice.actions;

export default editorSlice.reducer;
