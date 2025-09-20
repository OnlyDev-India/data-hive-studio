import { Button } from "@/components/ui/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { updateFile } from "@/redux/features/open-files";
import { AppDispatch, RootState } from "@/redux/store";
import { VisualizerFileType } from "@/types/file.type";
import { CheckIcon, Grid2X2PlusIcon } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";

const AddTableToView = () => {
  const { tables } = useSelector((state: RootState) => state.tables);
  const { currentFile } = useSelector((state: RootState) => state.openFiles);
  const cFile = currentFile as VisualizerFileType;
  const dispatch = useDispatch<AppDispatch>();
  const handleAddTable = (table: any) => {
    let newTables = [];
    if (
      cFile?.visualizerData?.tables?.some(
        (t: any) => t.table_name === table.table_name,
      )
    ) {
      newTables = cFile?.visualizerData?.tables?.filter(
        (t: any) => t.table_name !== table.table_name,
      );
    } else {
      newTables = [...(cFile?.visualizerData?.tables || []), table];
    }
    dispatch(
      updateFile({
        id: cFile?.id,
        visualizerData: {
          tables: newTables,
        },
      }),
    );
  };
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant={"ghost"}
              size={"icon"}
              className="h-[1.65rem] w-[1.65rem] rounded-r-none border-r bg-secondary/80 text-foreground transition-all duration-200 hover:bg-accent/80 [&_svg]:size-3"
            >
              <Grid2X2PlusIcon />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Add Table to View</TooltipContent>
      </Tooltip>
      <PopoverContent className="bg-secondary/70 p-0">
        <Command>
          <CommandInput placeholder="Search table..." />
          <CommandList className="custom-scrollbar">
            {tables.map((table: any) => {
              const isInView = cFile?.visualizerData?.tables?.some(
                (t: any) => t.table_name === table.table_name,
              );
              return (
                <CommandItem
                  key={table.table_name}
                  onSelect={() => handleAddTable(table)}
                  className="justify-between"
                >
                  {table.table_name}
                  {isInView && <CheckIcon className="h-4 w-4" />}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default AddTableToView;
