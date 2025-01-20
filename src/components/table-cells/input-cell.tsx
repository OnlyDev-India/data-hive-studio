import React from "react";
import { RenderCellProps } from "react-data-grid";
import { Input } from "../ui/input";
import { cn } from "@/lib/utils";

interface InputCellProps extends RenderCellProps<any> {
  name: string;
  className?: string;
}

const InputCell = ({ row, onRowChange, name, className }: InputCellProps) => {
  return (
    <Input
      value={row[name] || ""}
      title="Double click to edit"
      placeholder="null"
      onChange={(e) => onRowChange({ ...row, [name]: e.target.value })}
      className={cn(
        "rounded-none border-0 border-primary p-0 hover:border-b-2 focus-visible:border-b-2 focus-visible:outline-none focus-visible:ring-0",
        className,
      )}
    />
  );
};

export default InputCell;
