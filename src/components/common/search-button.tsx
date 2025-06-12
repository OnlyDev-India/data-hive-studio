"use client";
import React from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { SearchIcon, TableIcon } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { addTableFile } from "@/redux/features/open-files";
import { useRouter } from "next/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export function CommandMenu() {
  const [open, setOpen] = React.useState(false);
  // const [tables, setTables] = React.useState<any[]>([]);
  const { tables } = useSelector((state: any) => state.tables);
  const dispatch = useDispatch();
  const router = useRouter();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleSelect = (table: any) => {
    dispatch(addTableFile({ table_name: table.table_name }));
    console.log(router);

    router?.push("/app/editor");
    setOpen(false);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setOpen(true)}
            className="flex h-10 w-full items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <SearchIcon size={20} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          search
          <span className="text-xs text-muted-foreground">{` (ctrl+k)`}</span>
        </TooltipContent>
      </Tooltip>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        className="top-[5%] translate-y-0"
      >
        <CommandInput placeholder="Search Tables" className="bg-background" />
        <CommandList className="bg-background">
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading={`Tables ${tables ? tables.length : 0}`}>
            {tables?.map((table: any, index: number) => (
              <CommandItem
                key={index}
                className="data-[selected=true]:bg-secondary"
                onSelect={() => handleSelect(table)}
              >
                <TableIcon className="text-primary" />
                {table.table_name}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
