"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ENDPOINT_PAGE_TEST_NAVS } from "@/features/custom-api/config/navs";
import { cn } from "@/lib/utils";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";

const ApiTestSidebar = () => {
  const router = useRouter();
  // const { apiId, endpointId } = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const apiTestTab = searchParams.get("apiTestTab");

  const [activeTab, setActiveTab] = useState(
    apiTestTab || ENDPOINT_PAGE_TEST_NAVS[0].value,
  );

  useEffect(() => {
    setActiveTab(apiTestTab || ENDPOINT_PAGE_TEST_NAVS[0].value);
  }, [apiTestTab]);

  const handleNavClick = (value: string) => {
    setActiveTab(value);
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set("apiTestTab", value);
    router.push(`${pathname}?${searchParams.toString()}`);
  };

  return (
    <Tabs
      defaultValue={ENDPOINT_PAGE_TEST_NAVS[0].value}
      value={activeTab}
      onValueChange={handleNavClick}
      className="relative h-full w-full rounded-lg bg-secondary"
    >
      <div className="no-scrollbar flex w-full items-center justify-between overflow-auto rounded-t-lg border-b pr-2">
        <TabsList className="no-scrollbar h-[var(--tabs-height)] w-full justify-start overflow-auto rounded-none bg-secondary p-2">
          {ENDPOINT_PAGE_TEST_NAVS.map((nav) => {
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
      </div>
      <CustomTabsContent value={"curl"}>
        <h1>Hello</h1>
      </CustomTabsContent>
      <CustomTabsContent value={"response"}>
        <h1>Response</h1>
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

export default ApiTestSidebar;
