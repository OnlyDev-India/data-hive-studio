"use client";
import { ChevronRight, Table } from "lucide-react";
import { Button } from "../ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { TypeIcons, TypeIconsType } from "@/config/types-icon";
import { useDispatch } from "react-redux";
import { addTableFile } from "@/redux/features/open-files";
import TablesMenu from "../context-menu/tables-menu";

const Tree = ({
  item,
}: {
  item: { table_name: string; fields: { name: string; type: string }[] }[];
}) => {
  return (
    <div className="scrollable-container-gutter flex-1 overflow-auto custom-scrollbar">
      {item.map((subItem, index) => (
        <Branch key={index} subItem={subItem} />
      ))}
    </div>
  );
};

const Branch = ({
  subItem,
}: {
  subItem: { table_name: string; fields: { name: string; type: string }[] };
}) => {
  const [open, setOpen] = useState(false);
  const dispatch = useDispatch();
  const handleOpenFile = () => {
    dispatch(addTableFile({ table_name: subItem.table_name }));
  };
  return (
    <Collapsible
      className="group/collapsible [&[data-state=open]>div>svg:first-child]:rotate-90"
      open={open}
      onOpenChange={setOpen}
    >
      <div
        className={cn(
          "ml-2 flex items-center rounded-md pl-2 hover:bg-background",
          {
            "bg-background": open,
          },
        )}
      >
        {subItem.fields.length > 0 && (
          <CollapsibleTrigger asChild>
            <ChevronRight
              className="min-w-4 text-muted-foreground transition-transform hover:text-foreground"
              size={16}
            />
          </CollapsibleTrigger>
        )}
        <TablesMenu table_name={subItem.table_name}>
          <Button
            variant={"ghost"}
            className={cn(
              "w-full justify-start bg-transparent pl-2 text-xs hover:bg-transparent",
            )}
            onDoubleClick={(e) => {
              e.stopPropagation();
              // console.log("hello");
              handleOpenFile();
            }}
          >
            <p className="flex items-center gap-2 truncate">
              <Table className="text-muted-foreground" />
              {subItem.table_name}
            </p>
          </Button>
        </TablesMenu>
      </div>
      <CollapsibleContent className="ml-6 border-l-2 border-background pl-4">
        <div className="cursor-default space-y-0.5">
          {subItem.fields.map((field, index) => {
            const Icon = TypeIcons[field.type.toLowerCase() as TypeIconsType];
            return (
              <div
                key={index}
                className="flex justify-between gap-2 pr-4 text-xs"
              >
                <p className="flex items-center gap-2 truncate">
                  {Icon && (
                    <Icon size={14} className="min-w-[14px] text-yellow-400" />
                  )}
                  <span className="truncate">{field.name}</span>
                </p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="max-w-[100px] truncate rounded-md bg-background p-0.5 px-2">
                      {field.type}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{field.type}</TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
export default Tree;
