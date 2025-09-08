"use client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ENDPOINT_PAGE_NAVS } from "@/features/custom-api/config/navs";
import { cn } from "@/lib/utils";
import { useResizable } from "@/providers/resizable-provider";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";

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
  const isCollapsed = resizableState.size?.[0] === 5.5 ? true : false;

  useEffect(() => {
    setActiveTab(detailsTab || ENDPOINT_PAGE_NAVS[0].value);
  }, [detailsTab]);

  const handleToggle = () => {
    if (!isCollapsed) {
      toggleResizable("endpoint-page", "collapsed", [5.5, 94.5]);
    } else {
      toggleResizable("endpoint-page", "expanded", [50, 50]);
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
      <div className="no-scrollbar flex w-full items-center justify-between overflow-auto rounded-t-lg border-b pr-2">
        <TabsList className="no-scrollbar h-[var(--tabs-height)] w-full justify-start overflow-auto rounded-none bg-secondary p-2">
          {ENDPOINT_PAGE_NAVS.map((nav) => {
            const Icon = nav.icon;
            const isActive = activeTab === nav.value;
            return (
              <div
                key={nav.value}
                className={cn(
                  "group flex h-full items-center justify-between rounded-md border border-transparent hover:bg-background active:cursor-grabbing",
                  {
                    "border-primary bg-primary/20 hover:bg-primary/40":
                      isActive,
                  },
                )}
              >
                <TabsTrigger
                  value={nav.value}
                  className="h-full rounded-md bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=active]:bg-transparent"
                >
                  <span className="flex items-center gap-1 text-xs">
                    {Icon && (
                      <Icon
                        size={14}
                        className={cn({
                          "text-primary": isActive,
                        })}
                      />
                    )}
                    {nav.label}
                  </span>
                </TabsTrigger>
              </div>
            );
          })}
        </TabsList>
        <Button
          variant={"outline"}
          size={"icon"}
          onClick={handleToggle}
          className="h-8 w-8 rounded-md [&_svg]:size-4"
        >
          {isCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </Button>
      </div>
      <CustomTabsContent value={"overview"}>
        <h1>Hello</h1>
      </CustomTabsContent>
      <CustomTabsContent value={"workbench"}>
        <h1>Hello Workbench</h1>
      </CustomTabsContent>
      <CustomTabsContent value={"test"}>
        <h1>Test</h1>
      </CustomTabsContent>
    </Tabs>
  );
};

const CustomTabsContent = ({
  children,
  value,
}: {
  children: React.ReactNode;
  value: string;
}) => {
  return (
    <TabsContent
      value={value}
      className="m-0 h-[calc(100%-var(--tabs-height))] p-0"
    >
      {children}
    </TabsContent>
  );
};

export default DetailsPanelNav;
