"use client";
import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Button } from "../ui/button";
import { DownloadIcon, FileDownIcon, FileUpIcon, MoreVerticalIcon } from "lucide-react";
import { Tooltip, TooltipContent } from "../ui/tooltip";
import { TooltipTrigger } from "@radix-ui/react-tooltip";
import { useSelector } from "react-redux";
import { FileTableType } from "@/types/file.type";
import { getTableColumns, getTablesData } from "@/lib/actions/fetch-data";
import useBgProcess from "@/hooks/use-bgProcess";
import { toast } from "sonner";
import * as xlsx from "xlsx";
import {
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { DropdownMenu } from "../ui/dropdown-menu";

const exportToCSV = (columns: any, data: any) => {
  const csvHeader = columns.map((column: any) => column.name).join(",");

  const csvRows = data.map((row: any) => {
    return columns
      .map((column: any) => {
        if (column.key) {
          return row[column.key]?.toString();
        } else {
          return row[column.column_name]?.toString();
        }
      })
      .join(",");
  });

  const csvContent = [csvHeader, ...csvRows].join("\n");
  return csvContent;
};

const exportToJSON = (data: any) => {
  return JSON.stringify(data, null, 2);
};

const exportToExcel = (columns: any, data: any) => {
  // Convert JSON data to a worksheet
  // TODO: implement this
  const wb = xlsx?.utils.book_new();
  const ws = xlsx?.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
  const excelBuffer = xlsx.write(wb, {
    bookType: "xlsx",
    type: "buffer",
  });

  // Return the buffer
  return excelBuffer;
};

const DownloadMenu = [
  { label: "CSV", format: ".csv", value: "csv" },
  { label: "JSON", format: ".json", value: "json" },
  { label: "Excel", format: ".xlsx", value: "xlsx" },
];

const filteredMenu = [
  {
    label: "Whole Table",
    description: "Whole tables data will be exported",
    value: "table",
  },
  {
    label: "Selected",
    description: "Selected rows will be exported",
    value: "selected",
  },
  {
    label: "Filtered Data",
    description: "Filtered data will be exported",
    value: "filtered",
  },
];

interface ExportModalProps {
  data?: any;
  columns?: any;
  selectedData?: any;
  tableName?: string;
}

const ExportModal = ({
  data,
  columns,
  selectedData,
  tableName,
}: ExportModalProps) => {
  const [open, setOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { currentFile }: { currentFile: FileTableType } = useSelector(
    (state: any) => state.openFiles,
  );
  const [formData, setFormData] = useState({
    type: "filtered",
    name: tableName || currentFile?.tableName || "Output",
    format: "csv",
    outputDir: "",
  });
  const { addBgProcess, updateBgProcess } = useBgProcess();

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    addBgProcess({
      name: "Export",
      id: "export",
      status: "running",
      subProcesses: [
        { name: tableName || currentFile?.name, status: "running" },
      ],
    });
    setOpen(false);
    let exportData = null;
    let exportColumns = columns;
    if (formData.type === "filtered" && data && columns) {
      exportData = data;
    }
    if (formData.type === "selected" && selectedData && columns) {
      exportData = data.filter((_: any, index: number) =>
        selectedData.includes(index),
      );
    }
    if (formData.type === "table" && data && columns) {
      const { columns } = await getTableColumns(
        tableName || currentFile?.tableName,
      );
      const { data, totalRecords } = await getTablesData(
        tableName || currentFile?.tableName,
      );
      const rows = ((await JSON.parse(data || "")) || []).map((item: any) => {
        const copiedItem = JSON.parse(JSON.stringify(item));
        Object.keys(item).forEach((key) => {
          if (typeof item[key] === "object")
            copiedItem[key] = item[key]?.toString();
        });
        return copiedItem;
      });
      exportData = rows;
      exportColumns = columns;
    }
    if (!exportData || !exportColumns) return;

    let convertedData = null;

    if (formData.format === "csv") {
      convertedData = exportToCSV(exportColumns, exportData);
    }

    if (formData.format === "json") {
      convertedData = exportToJSON(exportData);
    }

    if (formData.format === "xlsx") {
      convertedData = exportToExcel(exportColumns, exportData);
    }

    if (convertedData) {
      if (window.electron) {
        const result = await window.electron.saveFile(
          convertedData,
          `${formData.outputDir}/${formData.name}.${formData.format}`,
        );
        if (result.success) {
          toast.success("Exported Successfully");
        } else {
          toast.error("Export Failed");
        }
      } else {
        const blob = new Blob([convertedData], {
          type: "text/csv;charset=utf-8;",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${formData.name}.${formData.format}`;
        link.click();
      }
    }
    updateBgProcess({
      id: "export",
      status: "completed",
      subProcesses: [
        {
          name: currentFile.name,
          status: "completed",
          details: `${formData.name}.${formData.format} exported successfully`,
        },
      ],
    });
  };

  useEffect(() => {
    const exportPath = localStorage.getItem("export-path") || "";
    // dateformat dd-mm-yyyy
    const formattedDate = new Date()
      .toLocaleDateString("en-GB")
      .replaceAll("/", "-");
    // time format hh-mm-ss
    const time = new Date()
      .toLocaleTimeString("en-US", { hour12: false })
      .replaceAll(":", "-");
    const filename = `${tableName || currentFile?.tableName}-${formattedDate}-${time}`;
    setFormData({
      ...formData,
      name: filename,
      outputDir: exportPath,
    });
  }, [tableName, currentFile?.tableName]);

  const handleOpenDir = async () => {
    try {
      const exportPath = localStorage.getItem("export-path") || "";
      const result = await window.electron?.openSelectDir(exportPath);
      if (!result) return;
      const { canceled, filePaths } = result;
      if (canceled) return;
      const newExportPath = filePaths[0];
      localStorage.setItem("export-path", newExportPath);
      setFormData({ ...formData, outputDir: newExportPath });
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger
          disabled={tableName ? false : !columns || columns?.length === 0}
          asChild
        >
          <Button
            variant={"outline"}
            size={"icon"}
            className="h-7 w-7 border-border [&_svg]:size-3"
          >
            <MoreVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end">
          <DropdownMenuItem
            className="text-xs"
            onClick={() => {
              setOpen(true);
              setDropdownOpen(false);
            }}
          >
            <FileDownIcon size={12} />
            Export Data
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-xs"
            disabled
          >
            <FileUpIcon size={12} />
            Import Data
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Data</DialogTitle>
            <DialogDescription className="text-xs">
              Export Data to CSV, JSON, or Excel File, If number of records are
              greater, it will run in background
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleFormSubmit}>
            <div className="space-y-2">
              {(tableName || currentFile?.tableName) && (
                <div className="space-y-2">
                  <Label htmlFor="format" className="text-xs">
                    Export
                  </Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) => {
                      setFormData({ ...formData, type: value });
                    }}
                  >
                    <SelectTrigger className="w-[180px] border-border bg-secondary">
                      <SelectValue placeholder="Theme" />
                    </SelectTrigger>
                    <SelectContent className="bg-secondary">
                      {filteredMenu.map((item, index) => (
                        <SelectItem
                          key={index}
                          value={item.value}
                          className="flex cursor-pointer justify-between text-xs hover:bg-primary/60"
                        >
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex w-full items-center gap-1.5">
                <div className="w-full space-y-2">
                  <Label htmlFor="name" className="text-xs">
                    File Name
                  </Label>
                  <Input
                    id="name"
                    placeholder="File Name"
                    className="w-full border-border bg-secondary"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="format" className="text-xs">
                    Format
                  </Label>
                  <Select
                    value={formData.format}
                    onValueChange={(value) => {
                      setFormData({ ...formData, format: value });
                    }}
                  >
                    <SelectTrigger className="w-[180px] border-border bg-secondary">
                      <SelectValue placeholder="Theme" />
                    </SelectTrigger>
                    <SelectContent className="bg-secondary">
                      {DownloadMenu.map((item, index) => (
                        <SelectItem
                          key={index}
                          value={item.value}
                          className="flex cursor-pointer justify-between text-xs hover:bg-primary/60"
                          // disabled={item.disabled}
                        >
                          {item.label}{" "}
                          <span className="text-xs text-muted-foreground">
                            {`(${item.format})`}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {window.electron?.openSelectDir !== undefined && (
                <div className="w-full space-y-2">
                  <Label htmlFor="name" className="text-xs">
                    Output Directory
                  </Label>
                  <div className="flex items-center">
                    <Input
                      id="name"
                      placeholder="File Name"
                      className="w-full rounded-r-none border-r-0 border-border bg-secondary !text-xs"
                      value={formData.outputDir}
                      readOnly
                      onClick={handleOpenDir}
                    />
                    <Button
                      type="button"
                      variant={"secondary"}
                      className="rounded-l-none border border-l-0 border-border bg-popover hover:bg-background/40"
                      onClick={handleOpenDir}
                    >
                      Choose
                    </Button>
                  </div>
                </div>
              )}
              <div className="!mt-8 flex w-full items-center justify-end">
                <Button type="submit" className="h-7 py-0 text-xs text-white">
                  Export
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ExportModal;
