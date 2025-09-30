"use client";
import ConnectionForm from "@/components/form/connection-form";
import ConnectionSidebar from "@/components/navbar/connection-side";
import ResizableLayout from "@/components/common/resizable-layout";

const ConnectionsPage = () => {

  return (
    <ResizableLayout
      child1={<ConnectionSidebar />}
      child2={<ConnectionForm />}
    />
  );
};

export default ConnectionsPage;
