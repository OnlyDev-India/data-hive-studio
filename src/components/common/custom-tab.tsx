import React from "react";
import { TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { cn } from "@/lib/utils";

export const CustomTabList = ({
  tabs,
  activeTab,
  children,
}: {
  tabs: { label: string; value: string; icon?: React.ElementType }[];
  activeTab: string;
  children?: React.ReactNode;
}) => {
  return (
    <div className="no-scrollbar flex w-full items-center justify-between overflow-auto rounded-t-lg border-b pr-2">
      <TabsList className="no-scrollbar h-[var(--tabs-height)] w-full justify-start overflow-auto rounded-none bg-secondary p-2">
        {tabs.map((nav) => {
          const Icon = nav.icon;
          const isActive = activeTab === nav.value;
          return (
            <div
              key={nav.value}
              className={cn(
                "group flex h-full items-center justify-between rounded-md border border-transparent hover:bg-background active:cursor-grabbing",
                {
                  "border-primary bg-primary/20 hover:bg-primary/40": isActive,
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
      {children}
    </div>
  );
};

export const CustomTabsContent = ({
  children,
  value,
  className,
}: {
  children: React.ReactNode;
  value: string;
  className?: string;
}) => {
  return (
    <TabsContent
      value={value}
      className={cn("m-0 h-[calc(100%-var(--tabs-height))] overflow-auto p-0 scrollbar-gutter custom-scrollbar", className)}
    >
      {children}
    </TabsContent>
  );
};
