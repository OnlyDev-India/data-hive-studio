"use client";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { LaptopMinimalIcon, PlusIcon } from "lucide-react";
import React, { useEffect, useState } from "react";

const ConnectionPageSidebar = () => {
  const [isWeb, setIsWeb] = useState(true);
  useEffect(() => {
    if (window?.electron) {
      setIsWeb(false);
    }
  }, []);
  return (
    <div className="z-10 h-full w-full flex-col justify-center bg-background px-0 py-4">
      {!isWeb && (
        <div
          className={cn(
            "w-full rounded-none border-l-2 border-transparent px-2 data-[state=active]:border-primary",
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size={"icon"}
                variant={"secondary"}
                className="flex items-center justify-center rounded-full"
              >
                <LaptopMinimalIcon size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>
              Local Workspace
            </TooltipContent>
          </Tooltip>
        </div>
      )}
      <div
        className={cn(
          "w-full rounded-none border-l-2 border-transparent px-2 data-[state=active]:border-primary",
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size={"icon"}
              variant={"ghost"}
              className="flex items-center justify-center rounded-full"
            >
              <PlusIcon size={20} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            Create Workspace {"Coming soon"}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};

export default ConnectionPageSidebar;
