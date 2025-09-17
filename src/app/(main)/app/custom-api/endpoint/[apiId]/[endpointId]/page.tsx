"use client";
import ResizableLayout from "@/components/common/resizable-layout";
import EndpointPageDetails from "@/features/custom-api/components/endpoint-page-details";
import EndpointPageStatus from "@/features/custom-api/components/endpoint-page-status";
import WorkbenchSidebar from "@/features/custom-api/components/api-workbench/editbar/workbench-sidebar";
import ApiTestSidebar from "@/features/custom-api/components/api-test-sidebar";
import { useWorkbenchRedux } from "@/features/custom-api/hooks/use-workbench-redux";

const EndpointPage = ({
  searchParams,
}: {
  searchParams: { detailsTab: string };
}) => {
  const { getCurrentIsAddingNode, getCurrentSelectedNodeId } = useWorkbenchRedux();
  const rightSidebar: { [key: string]: React.ReactNode } = {
    workbench: getCurrentIsAddingNode() || getCurrentSelectedNodeId() ? <WorkbenchSidebar /> : null,
    test: <ApiTestSidebar />,
  };
  return (
      <div className="h-full w-full rounded-lg bg-background">
        <ResizableLayout
          child1={
            <ResizableLayout
              child1={<EndpointPageDetails />}
              child2={<EndpointPageStatus />}
              direction="vertical"
              config={"endpointPage"}
              activeId="endpoint-page"
              isSidebar={false}
              isSubLayout={true}
            />
          }
          child2={
            rightSidebar[searchParams.detailsTab]
              ? rightSidebar[searchParams.detailsTab]
              : null
          }
          activeId="endpoint-page-components"
          config={"endpointPageComponents"}
          collapsible={false}
          isSidebar={false}
          isSubLayout={true}
        />
      </div>
  );
};

export default EndpointPage;
