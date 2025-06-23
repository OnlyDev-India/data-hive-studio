"use client";
import ConnectionForm from "@/components/form/connection-form";
import ConnectionSidebar from "@/components/navbar/connection-side";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useDispatch } from "react-redux";
import { initAppData } from "@/redux/features/appdb";
import { useEffect } from "react";

const ConnectionsPage = () => {
  const dispatch = useDispatch();
  // console.log(loading);
  const connectDb = async () => {
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
      <ResizableHandle className="!w-2 bg-background" />
      <ResizablePanel defaultSize={80} minSize={30} maxSize={80} className="p-2 pl-0">
        <div className="h-full w-full flex-1 bg-secondary rounded-lg">
          <ConnectionForm />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export default ConnectionsPage;
