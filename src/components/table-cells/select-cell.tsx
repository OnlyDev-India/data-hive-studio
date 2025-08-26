"use client";
import { RenderCellProps } from "react-data-grid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "@/lib/utils";
import { Input } from "../ui/input";
import { useState } from "react";

interface SelectCellProps extends RenderCellProps<any> {
  name: string;
  items: { label: string; value: string | null }[];
  disabled?: boolean;
  className?: string;
}

const SelectCell = ({
  row,
  onRowChange,
  name,
  items,
  className,
  disabled = false,
}: SelectCellProps) => {
  const [search, setSearch] = useState("");
  const value =
    typeof row[name] === "string" ? row[name]?.trim() : row[name]?.toString();

  const handleValueChange = (value: string) => {
    let sanitizedValue: any = value;
    
    // Sanitize the selected value
    if (value === "undefined" || value === "$undefined") {
      sanitizedValue = undefined;
    } else if (value === "true") {
      sanitizedValue = true;
    } else if (value === "false") {
      sanitizedValue = false;
    } else if (value === "null" || value === "") {
      sanitizedValue = null;
    }
    
    onRowChange({
      ...row,
      [name]: sanitizedValue,
    });
  };

  return (
    <Select
      value={value}
      onValueChange={handleValueChange}
    >
      <SelectTrigger
        disabled={disabled}
        className={cn(
          "border-0 p-0 focus:outline-none focus:ring-0 bg-transparent",
          {
            "[&_span]:text-muted-foreground": value === "" || !value,
          },
          className,
        )}
      >
        <SelectValue placeholder={"(null)"} />
      </SelectTrigger>
      <SelectContent>
        {items
          .filter((item) =>
            item.label.toLowerCase().includes(search.toLowerCase()),
          )
          .map((item, index) => (
            <SelectItem key={index} value={item.value?.toString() || " "}>
              {item.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
};

export default SelectCell;
