"use client";
import {
  addBgProcess,
  clearCompletedProcesses,
  moveToCompleted,
  removeBgProcess,
  removeCompletedProcess,
  resetBgProcess,
  updateBgProcess,
} from "@/redux/features/background-processes";
import { useDispatch, useSelector } from "react-redux";

const useBgProcess = () => {
  const { processes, completedProcesses } = useSelector((state: any) => state.bgProcesses);
  const dispatch = useDispatch();
  return {
    processes,
    completedProcesses,
    addBgProcess: (value: any) => {
      dispatch(addBgProcess(value));
    },
    removeBgProcess: (value: any) => {
      dispatch(removeBgProcess(value));
    },
    resetBgProcess: () => {
      dispatch(resetBgProcess());
    },
    updateBgProcess: (value: any) => {
      dispatch(updateBgProcess(value));
    },
    moveToCompleted: (value: any) => {
      dispatch(moveToCompleted(value));
    },
    clearCompletedProcesses: () => {
      dispatch(clearCompletedProcesses());
    },
    removeCompletedProcess: (value: any) => {
      dispatch(removeCompletedProcess(value));
    },
  };
};

export default useBgProcess;
