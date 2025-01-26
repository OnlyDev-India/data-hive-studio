import { connectDb } from "@/lib/actions/fetch-data";
import Head from "next/head";
import { redirect } from "next/navigation";
import React from "react";

const MainLayout = async ({ children }: { children: React.ReactNode }) => {
  const { response, connectionDetails } = await connectDb();
  if (!response?.success) redirect("/");

  return (
    <>
      {connectionDetails && (
        <Head>
          <title>{connectionDetails.database}</title>
        </Head>
      )}
      {children}
    </>
  );
};

export default MainLayout;
