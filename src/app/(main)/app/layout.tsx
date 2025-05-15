import { connectDb } from "@/lib/actions/fetch-data";
import { redirect } from "next/navigation";
import React from "react";
import { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const { response, connectionDetails } = await connectDb();
  
  if (!response?.success) {
    return {
      title: 'Data Hive Studio'
    };
  }

  return {
    title: `${connectionDetails?.name} - ${connectionDetails?.database}`
  };
}

const MainLayout = async ({ children }: { children: React.ReactNode }) => {
  const { response } = await connectDb();
  if (!response?.success) redirect("/");

  return <>{children}</>;
};

export default MainLayout;
