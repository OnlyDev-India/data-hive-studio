import Sidebar from "@/components/navbar/sidebar";
import SubSideBar from "@/components/navbar/sub-sidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { connectDb } from "@/lib/actions/fetch-data";
import { HandlersTypes } from "@/lib/databases/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";

const MainLayout = async ({ children }: { children: React.ReactNode }) => {
  const cookie = cookies();
  const connectionUrl = cookie.get("currentConnection");
  const dbType = cookie.get("dbType");
  const response = await connectDb({
    connectionString: connectionUrl?.value || "",
    dbType: (dbType?.value as HandlersTypes) || null,
  });
  // if (!response?.success) redirect("/");

  return (
    <div className="h-screen w-screen">
      <div className="h-full w-full">
        <div className="flex h-full w-full">
          <Sidebar />
          {children}
        </div>
      </div>
    </div>
  );
};

export default MainLayout;
