import React from "react";
import { RenderCellProps } from "react-data-grid";
import { Input } from "../ui/input";
import { cn } from "@/lib/utils";
import { ColumnProps } from "../table";

interface InputCellProps extends Omit<RenderCellProps<any>, "column"> {
  name: string;
  className?: string;
  column: ColumnProps;
}

const InputCell = ({ row, onRowChange, name, className }: InputCellProps) => {
  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value: any = e.target.value;
    
    // Sanitize the input value
    if (value === "") {
      value = null; // Convert empty string to null
    } else if (value === "undefined" || value === "$undefined") {
      value = undefined; // Convert these strings back to undefined
    }
    
    onRowChange({ ...row, [name]: value });
  };

  return (
    <Input
      value={row[name] || ""}
      title="Double click to edit"
      placeholder="null"
      onChange={handleValueChange}
      className={cn(
        "rounded-none border-0 border-primary p-0 hover:border-b-2 focus-visible:border-b-2 focus-visible:outline-none focus-visible:ring-0",
        className,
      )}
      variant="secondary"
    />
  );
};

export default InputCell;
