"use client";
import Tree from "@/components/common/tree";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { addNewTableFile } from "@/redux/features/open-files";
import { fetchTables } from "@/redux/features/tables";
import { ChevronRightIcon, PlusIcon, RotateCwIcon } from "lucide-react";
import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";

const SideBarTables = () => {
  const { tables, loading } = useSelector((state: any) => state.tables);

  const dispatch = useDispatch();

  const handleFetchTables = async () => {
    dispatch(fetchTables() as any);
  };

  const handleAddNewTable = () => {
    dispatch(addNewTableFile());
  };

  useEffect(() => {
    handleFetchTables();
  }, [dispatch]);
  return (
    <Collapsible
      defaultOpen
      className="group/collapsible [&[data-state=open]>div>svg:first-child]:rotate-90"
    >
      <div className="flex items-center justify-between sticky top-0 bg-secondary w-full text-sm uppercase font-semibold shadow-md z-10 group">
        <div className="flex items-center gap-1">
          <CollapsibleTrigger asChild>
            <ChevronRightIcon className="transition-transform" size={16} />
          </CollapsibleTrigger>
          <p className="flex items-center gap-2 py-2">
            Tables
            <span className="text-muted-foreground lowercase text-xs">
              {"(public)"}
            </span>
            <span className="text-muted-foreground bg-popover p-0.5 px-1 rounded-full text-xs">
              {tables ? tables.length : 0}
            </span>
          </p>
        </div>
        <div className="[&_button]:!w-6 [&_button]:!h-6 text-xs">
          <Button
            variant={"ghost"}
            size={"icon"}
            onClick={handleFetchTables}
            className="group-hover:visible invisible text-muted-foreground hover:text-foreground"
            title="Reload tables"
          >
            <RotateCwIcon className={cn({ "animate-spin": loading })} />
          </Button>
          <Button
            variant={"ghost"}
            size={"icon"}
            onClick={handleAddNewTable}
            className="text-muted-foreground hover:text-foreground"
          >
            <PlusIcon />
          </Button>
        </div>
      </div>
      <CollapsibleContent>
        {tables && <Tree item={tables} />}
      </CollapsibleContent>
    </Collapsible>
  );
};

export default SideBarTables;
