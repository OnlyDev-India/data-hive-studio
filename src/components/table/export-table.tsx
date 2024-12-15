import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from "../ui/button";
import { DownloadIcon } from "lucide-react";

const DownloadMenu = [
  { label: "CSV", format: ".csv" },
  { label: "JSON", format: ".json" },
  { label: "Excel", format: ".xlsx" },
];

const ExportTable = () => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={"outline"}
          size={"icon"}
          //   onClick={refetchData}
          className="h-7 w-7 border-border [&_svg]:size-3"
        >
          <DownloadIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="bg-secondary/70 backdrop-blur-md"
      >
        {DownloadMenu.map((item, index) => (
          <DropdownMenuItem
            key={index}
            className="focus:bg-primary/60 text-xs cursor-pointer"
          >
            Export {item.label}
            <DropdownMenuShortcut>{item.format}</DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ExportTable;
