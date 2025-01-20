import Sidebar from "@/components/navbar/sidebar";
import { connectDb } from "@/lib/actions/fetch-data";
import { redirect } from "next/navigation";
import React from "react";

const MainLayout = async ({ children }: { children: React.ReactNode }) => {
  const response = await connectDb();
  if (!response?.success) redirect("/");

  return children;
};

export default MainLayout;
