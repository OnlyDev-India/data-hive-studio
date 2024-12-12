import React, { useEffect } from "react";
import { Column } from "react-data-grid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { compareFilter } from "@/config/filter";
import { Input } from "../ui/input";
import { TypeIcons, TypeIconsType } from "@/config/types-icon";
import { useDebouncedCallback } from "@/hooks/debounce";

interface ColumnProps extends Column<any> {
  data_type?: string;
}

const Filter = ({
  columns,
  setFilter,
}: {
  columns: ColumnProps[];
  setFilter: any;
}) => {
  const [filterValue, setFilterValue] = React.useState<any>({
    column: columns[0],
    compare: "equals",
    value: "",
  });
  const debounce = useDebouncedCallback((filter: any) => {
    console.log(filter);

    setFilter(filter);
  }, 1000);
  const handleColumnFilter = (key: string) => {
    const selectedColumn = columns.find((column) => column.key === key);

    setFilterValue({ ...filterValue, column: selectedColumn });
  };

  useEffect(() => {
    setFilterValue({ ...filterValue, column: columns[0] });
  }, [columns]);

  const handleCompareFilter = (value: string) => {
    setFilterValue({ ...filterValue, compare: value });
  };

  const handleFilterValue = (value: string) => {
    setFilterValue({ ...filterValue, value: value });
    debounce({ ...filterValue, value: value });
  };

  return (
    <div className="flex-1 flex gap-2">
      <Select defaultValue="id" onValueChange={handleColumnFilter}>
        <SelectTrigger className="w-[180px] bg-secondary">
          <SelectValue placeholder="Filter" />
        </SelectTrigger>
        <SelectContent className="bg-secondary/70 backdrop-blur-md">
          {columns?.map((column: ColumnProps) => {
            const Icon =
              TypeIcons[column.data_type?.toLowerCase() as TypeIconsType];
            return (
              <SelectItem
                key={column.key}
                value={column.key}
                className="focus:bg-primary/60 cursor-pointer"
              >
                <p className="flex items-center gap-2">
                  {Icon && <Icon size={14} className="text-yellow-400" />}
                  {column.name}
                </p>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Select defaultValue="equals" onValueChange={handleCompareFilter}>
        <SelectTrigger className="w-[180px] bg-secondary">
          <SelectValue placeholder="Filter" />
        </SelectTrigger>
        <SelectContent className="bg-secondary/70 backdrop-blur-md">
          {compareFilter?.map((column) => {
            if (
              !column.types.includes(filterValue.column?.data_type) &&
              !column.types.includes("all")
            )
              return null;
            return (
              <SelectItem
                key={column.key}
                value={column.key}
                className="focus:bg-primary/60 cursor-pointer"
              >
                {column.value}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Input
        className="flex-1 bg-secondary"
        value={filterValue.value}
        onChange={(e) => handleFilterValue(e.target.value)}
        placeholder="Enter Value"
      />
    </div>
  );
};

export default Filter;
