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

  return (
    <Select
      value={value}
      onValueChange={(value) =>
        onRowChange({
          ...row,
          [name]: value === "true" ? true : value === "false" ? false : value,
        })
      }
    >
      <SelectTrigger
        disabled={disabled}
        className={cn(
          "focus:outline-none focus:ring-0 border-0 p-0",
          {
            "[&_span]:text-muted-foreground": value === "" || !value,
          },
          className
        )}
      >
        <SelectValue placeholder={"(null)"} />
      </SelectTrigger>
      <SelectContent>
        {/* <Input
          className="bg-secondary sticky top-0"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        /> */}
        {items
          .filter((item) =>
            item.label.toLowerCase().includes(search.toLowerCase())
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
