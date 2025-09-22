import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addOpenFiles } from "@/redux/features/open-files";
import { AppDispatch } from "@/redux/store";
import { FileType } from "@/types/file.type";
import {
  ChevronDownIcon,
  FilePlus2Icon,
  PlusIcon,
  TableIcon,
  WaypointsIcon,
} from "lucide-react";
import { useDispatch } from "react-redux";

const AddNewFile = () => {
  const dispatch = useDispatch<AppDispatch>();
  const handleAddNewFile = (type?: FileType["type"]) => {
    dispatch(addOpenFiles(type || "file"));
  };
  return (
    <div className="sticky right-0 flex h-full items-center gap-[2px] bg-secondary px-2">
      <Button
        variant="outline"
        size="icon"
        className="h-6 w-6 min-w-6 rounded-r-none border-border text-foreground hover:border-primary hover:text-primary [&_svg]:size-4"
        onClick={() => handleAddNewFile()}
      >
        <PlusIcon size={14} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-5 min-w-4 rounded-l-none border-border p-0 text-foreground hover:border-primary hover:text-primary [&_svg]:size-3.5"
          >
            <ChevronDownIcon size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="">
          <DropdownMenuItem onSelect={() => handleAddNewFile("file")}>
            <FilePlus2Icon size={14} />
            New File
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleAddNewFile("newTable")}>
            <TableIcon size={14} />
            New Table
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleAddNewFile("visualizer")}>
            <WaypointsIcon size={14} />
            New Visualizer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default AddNewFile;
