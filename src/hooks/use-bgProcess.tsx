"use client";
import {
  addBgProcess,
  moveToCompleted,
  removeBgProcess,
  resetBgProcess,
  updateBgProcess,
} from "@/redux/features/background-processes";
import { useDispatch, useSelector } from "react-redux";

const useBgProcess = () => {
  const { processes } = useSelector((state: any) => state.bgProcesses);
  const dispatch = useDispatch();
  return {
    processes,
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
  };
};

export default useBgProcess;
