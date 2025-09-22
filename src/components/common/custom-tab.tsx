import React from "react";
import { TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { cn } from "@/lib/utils";
import { XIcon } from "lucide-react";

export const CustomTabList = ({
  tabs,
  activeTab,
  children,
  className,
  onTabChange,
  onTabClose,
}: {
  tabs: { label: string; value: string; icon?: React.ElementType }[];
  activeTab: string;
  children?: React.ReactNode;
  className?: string;
  onTabChange?: (value: string) => void;
  onTabClose?: (value: string) => void;
}) => {
  return (
    <div
      className={cn(
        "no-scrollbar flex w-full items-center justify-between gap-2 overflow-auto rounded-t-lg border-b pr-2",
        className,
      )}
    >
      <TabsList
        className={cn(
          "no-scrollbar h-[var(--tabs-height)] w-full justify-start overflow-auto rounded-none bg-secondary p-2",
          { "pr-0": onTabClose },
        )}
      >
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
                className={cn(
                  "h-full rounded-md bg-transparent text-foreground focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none",
                  { "pr-0": onTabClose },
                )}
                onClick={() => {
                  onTabChange?.(nav.value);
                }}
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
              {onTabClose && (
                <p
                  className="invisible flex h-6 w-6 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground group-hover:visible"
                  onClick={() => {
                    onTabClose(nav.value);
                  }}
                >
                  <XIcon size={14} />
                </p>
              )}
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
      className={cn(
        "scrollbar-gutter custom-scrollbar m-0 h-[calc(100%-var(--tabs-height))] overflow-auto p-0",
        className,
      )}
    >
      {children}
    </TabsContent>
  );
};
