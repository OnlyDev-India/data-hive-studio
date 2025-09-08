"use client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ENDPOINT_PAGE_STATUS_NAVS } from "@/features/custom-api/config/navs";
import { cn } from "@/lib/utils";
import { useResizable } from "@/providers/resizable-provider";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";

const StatusPanelNav = () => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusTab = searchParams.get("statusTab");
  const [activeTab, setActiveTab] = useState(
    statusTab || ENDPOINT_PAGE_STATUS_NAVS[0].value,
  );
  const [isFirstRender, setIsFirstRender] = useState(true);
  const { toggleResizable, getResizableState } = useResizable();
  const resizableState = getResizableState("endpoint-page");
  //   TODO: fix the collapsed panel
  const isCollapsed = resizableState.size?.[1] === 5.5 ? true : false;

  useEffect(() => {
    setActiveTab(statusTab || ENDPOINT_PAGE_STATUS_NAVS[0].value);
  }, [statusTab]);

  const handleToggle = () => {
    if (!isCollapsed) {
      toggleResizable("endpoint-page", "collapsed", [94.5, 5.5]);
    } else {
      toggleResizable("endpoint-page", "expanded", [50, 50]);
    }
  };
  const handleNavClick = (value: string) => {
    setActiveTab(value);
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set("statusTab", value);
    router.push(`${pathname}?${searchParams.toString()}`);
  };
  return (
    <Tabs
      defaultValue={ENDPOINT_PAGE_STATUS_NAVS[0].value}
      value={activeTab}
      onValueChange={handleNavClick}
      className="relative h-full w-full rounded-lg bg-secondary"
    >
      <div className="no-scrollbar flex w-full items-center justify-between overflow-auto rounded-t-lg border-b pr-2">
        <TabsList className="no-scrollbar h-[var(--tabs-height)] w-full justify-start overflow-auto rounded-none bg-secondary p-2">
          {ENDPOINT_PAGE_STATUS_NAVS.map((nav) => {
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
          {!isCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </Button>
      </div>
      <CustomTabsContent value={"logs"}>
        <h1>Logs</h1>
      </CustomTabsContent>
      <CustomTabsContent value={"errors"}>
        <h1>Errors</h1>
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

export default StatusPanelNav;
