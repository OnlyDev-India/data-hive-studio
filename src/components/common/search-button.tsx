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
import { getTablesWithFieldsFromDb } from "@/lib/actions/fetch-data";
import { useDispatch } from "react-redux";
import { addTableFile } from "@/redux/features/open-files";
import { useRouter } from "next/navigation";

export function CommandMenu() {
  const [open, setOpen] = React.useState(false);
  const [tables, setTables] = React.useState<any[]>([]);
  const dispatch = useDispatch();
  let router = useRouter();

  React.useEffect(() => {
    const fetchTables = async () => {
      if (open) {
        const fetchedTables = await getTablesWithFieldsFromDb();
        setTables(fetchedTables || []);
      }
    };
    fetchTables();
  }, [open]);

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
      <button
        onClick={() => setOpen(true)}
        className="w-full h-10 flex items-center justify-center hover:text-foreground"
      >
        <SearchIcon size={20} />
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search Tables" className="bg-background" />
        <CommandList className="bg-background">
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading={`Tables ${tables ? tables.length : 0}`}>
            {tables?.map((table: any, index) => (
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
