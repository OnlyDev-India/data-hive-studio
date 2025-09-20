"use client";
import React from "react";
import TablesList from "./tables-list";
import { useSearchParams } from "next/navigation";
import HistoryList from "./history-list";

const sideBarItems = {
  default: TablesList,
  history: HistoryList,
};

const SubSideBars = () => {
  const searchParams = useSearchParams();
  const search = searchParams.get("sidebar") || "default";
  const SideBarItem = sideBarItems[search as keyof typeof sideBarItems];
  return <SideBarItem />;
};

export default SubSideBars;
