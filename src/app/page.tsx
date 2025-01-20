"use client";
import ConnectionForm from "@/components/form/connection-form";
import ConnectionSidebar from "@/components/navbar/connection-side";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useDispatch } from "react-redux";
import { connectAppDB } from "@/lib/actions/app-data";
import { initAppData } from "@/redux/features/appdb";
import { useEffect } from "react";
import { parseConnectionString } from "@/lib/helper/connection-details";
import { ConnectionDetailsType } from "@/types/db.type";

const ConnectionsPage = () => {
  const dispatch = useDispatch();
  // console.log(loading);
  const connectDb = async () => {
    const dbPath = await window.electron?.getAppDbPath?.();
    const connectionDetails = parseConnectionString(
      "",
    ) as ConnectionDetailsType;
    connectionDetails.connectionString = dbPath;

    await connectAppDB({ connectionDetails });
    dispatch(initAppData() as any);
  };
  useEffect(() => {
    connectDb();
  }, []);

  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel defaultSize={20} minSize={20} maxSize={70}>
        <ConnectionSidebar />
      </ResizablePanel>
      <ResizableHandle className="!w-0.5 data-[resize-handle-state=drag]:bg-primary data-[resize-handle-state=hover]:bg-primary" />
      <ResizablePanel defaultSize={80} minSize={30} maxSize={80}>
        <div className="h-full w-full flex-1 bg-secondary">
          <ConnectionForm />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export default ConnectionsPage;
