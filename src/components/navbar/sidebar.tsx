"use client";
import { cn } from "@/lib/utils";
import { TabsList, TabsTrigger } from "../ui/tabs";
import { sideBadMenu } from "@/config/menu";
import { Button } from "../ui/button";
import { usePathname, useRouter } from "next/navigation";
import { disconnectDb } from "@/lib/actions/fetch-data";
import { CirclePowerIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useDispatch } from "react-redux";
import { resetOpenFiles } from "@/redux/features/open-files";
import { resetEditor } from "@/redux/features/editor";
import { resetQuery } from "@/redux/features/query";
import { resetTables } from "@/redux/features/tables";
import Link from "next/link";

const Sidebar = () => {
  const router = useRouter();
  const dispatch = useDispatch();
  const pathname = usePathname();
  const handleDisconnect = async () => {
    disconnectDb();
    dispatch(resetOpenFiles());
    dispatch(resetEditor());
    dispatch(resetQuery());
    dispatch(resetTables());
    router.push("/");
  };
  return (
    <div className="flex flex-col items-center pb-2">
      <div
        className={cn(
          `bg-background border-r border-border w-[var(--sidebar-width)] flex-col h-full justify-start px-0 z-10`
        )}
      >
        {sideBadMenu.map((item, index) => {
          if (item.btn) {
            return (
              // <TooltipProvider delayDuration={0}>
              //   <Tooltip>
              //     <TooltipTrigger asChild>
              <item.btn key={index} />
              //     </TooltipTrigger>
              //     <TooltipContent side="right" >
              //       {item.title}
              //     </TooltipContent>
              //   </Tooltip>
              // </TooltipProvider>
            );
          }
          return (
            <div
              key={index}
              className={cn(
                "p-2 border-l-2 border-transparent data-[state=active]:border-primary rounded-none w-full",
                { "border-primary": pathname.includes(item.link) }
              )}
            >
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {item.link && (
                      <Link
                        href={item.link}
                        className="flex items-center justify-center"
                      >
                        <item.icon size={20} />
                      </Link>
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={10}>
                    {item.title}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          );
        })}
      </div>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={"ghost"}
              size={"icon"}
              className="hover:bg-secondary"
              onClick={handleDisconnect}
            >
              <CirclePowerIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            Disconnect
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};

export default Sidebar;
