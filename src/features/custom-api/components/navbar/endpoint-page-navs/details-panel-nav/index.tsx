"use client";
import EndpointDetails from "./endpoint-details";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { ENDPOINT_PAGE_NAVS } from "@/features/custom-api/config/navs";
import { useResizable } from "@/providers/resizable-provider";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Workbench from "../../../api-workbench/workbench";
import { CustomTabList, CustomTabsContent } from "@/components/common/custom-tab";
import TestApi from "./test-api";

const DetailsPanelNav = () => {
  const router = useRouter();
  // const { apiId, endpointId } = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detailsTab = searchParams.get("detailsTab");

  const [activeTab, setActiveTab] = useState(
    detailsTab || ENDPOINT_PAGE_NAVS[0].value,
  );
  const { toggleResizable, getResizableState } = useResizable();
  const resizableState = getResizableState("endpoint-page");
  //   TODO: fix the collapsed panel
  const isCollapsed = resizableState.state === "collapsed" || resizableState.state === "collapsed:2";

  useEffect(() => {
    setActiveTab(detailsTab || ENDPOINT_PAGE_NAVS[0].value);
  }, [detailsTab]);

  const handleToggle = () => {
    if (!isCollapsed) {
      toggleResizable("endpoint-page", "collapsed");
    } else {
      toggleResizable("endpoint-page", "expanded");
    }
  };

  const handleNavClick = (value: string) => {
    setActiveTab(value);
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set("detailsTab", value);
    router.push(`${pathname}?${searchParams.toString()}`);
  };

  return (
    <Tabs
      defaultValue={ENDPOINT_PAGE_NAVS[0].value}
      value={activeTab}
      onValueChange={handleNavClick}
      className="relative h-full w-full rounded-lg bg-secondary"
    >
      <CustomTabList tabs={ENDPOINT_PAGE_NAVS} activeTab={activeTab} >
        
        <Button
          variant={"outline"}
          size={"icon"}
          onClick={handleToggle}
          className="h-8 w-8 rounded-md [&_svg]:size-4"
        >
          {isCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </Button>
      </CustomTabList>
      <CustomTabsContent value={"overview"}>
        <EndpointDetails />
      </CustomTabsContent>
      <CustomTabsContent value={"workbench"}>
        <Workbench />
      </CustomTabsContent>
      <CustomTabsContent value={"test"}>
        <TestApi />
      </CustomTabsContent>
    </Tabs>
  );
};

export default DetailsPanelNav;
