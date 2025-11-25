"use client";
import ConnectionForm from "@/components/form/connection-form";
import ResizableLayout from "@/components/common/resizable-layout";
import dynamic from "next/dynamic";

const ConnectionSidebar = dynamic(() => import("@/components/navbar/connection-side"), { ssr: false });
const ConnectionsPage = () => {

  return (
    <ResizableLayout
      child1={<ConnectionSidebar />}
      child2={<ConnectionForm />}
    />
  );
};

export default ConnectionsPage;
