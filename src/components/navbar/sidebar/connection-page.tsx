import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { LaptopMinimalIcon, PlusIcon } from "lucide-react";
import React from "react";

const ConnectionPageSidebar = () => {
  return (
    <div className="z-10 h-full w-full flex-col justify-center bg-background px-0">
      <div
        className={cn(
          "w-full rounded-none border-l-2 border-transparent p-2 data-[state=active]:border-primary",
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
      <div
        className={cn(
          "w-full rounded-none border-l-2 border-transparent p-2 data-[state=active]:border-primary",
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
