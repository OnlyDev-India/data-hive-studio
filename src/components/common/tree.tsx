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
    <div>
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
          "flex items-center hover:bg-background rounded-md ml-2 pl-2",
          {
            "bg-background": open,
          }
        )}
      >
        <CollapsibleTrigger asChild>
          <ChevronRight
            className="transition-transform text-muted-foreground hover:text-foreground"
            size={16}
          />
        </CollapsibleTrigger>
        <TablesMenu table_name={subItem.table_name}>
          <Button
            variant={"ghost"}
            className={cn(
              "w-full justify-start bg-transparent hover:bg-transparent pl-2 text-xs"
            )}
            onDoubleClick={(e) => {
              e.stopPropagation();
              // console.log("hello");
              handleOpenFile();
            }}
          >
            <p className="flex items-center gap-2 truncate">
              <Table className="text-primary" />
              {subItem.table_name}
            </p>
          </Button>
        </TablesMenu>
      </div>
      <CollapsibleContent className="ml-6 border-l-2 border-background pl-4">
        <div className="space-y-0.5 cursor-default">
          {subItem.fields.map((field, index) => {
            const Icon = TypeIcons[field.type.toLowerCase() as TypeIconsType];
            return (
              <div
                key={index}
                className="flex justify-between pr-4 gap-2 text-xs"
              >
                <p className="flex items-center gap-2 truncate">
                  {Icon && <Icon size={14} className="text-yellow-400" />}
                  <span className="truncate">{field.name}</span>
                </p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="max-w-[100px] truncate bg-background p-0.5 px-2 rounded-md ">
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
