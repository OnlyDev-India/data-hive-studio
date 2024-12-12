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

const ConnectionsPage = () => {
  const dispatch = useDispatch();
  // console.log(loading);
  const connectDb = async () => {
    const dbPath = await window.electron.getAppDbPath();
    await connectAppDB({ connectionString: dbPath });
    dispatch(initAppData() as any);
  };
  useEffect(() => {
    connectDb();
  }, []);

  return (
    <div className="h-screen w-screen">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={20} minSize={20} maxSize={70}>
          <ConnectionSidebar />
        </ResizablePanel>
        <ResizableHandle className="data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary !w-0.5" />
        <ResizablePanel defaultSize={80} minSize={30} maxSize={80}>
          <div className="flex-1 h-full w-full bg-secondary">
            <ConnectionForm />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default ConnectionsPage;
