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
import { useDispatch, useSelector } from "react-redux";
import { updateFile } from "@/redux/features/open-files";
import { Button } from "../ui/button";
import { PlusIcon, XIcon } from "lucide-react";

interface ColumnProps extends Column<any> {
  data_type?: string;
}

const Filter = ({ columns }: { columns: ColumnProps[] }) => {
  const initialFilter = {
    column: columns[0],
    compare: "equals",
    value: "",
    separator: "WHERE",
  };
  const [filterValues, setFilterValues] = React.useState<any>([initialFilter]);

  const { currentFile } = useSelector((state: any) => state.openFiles);
  const dispatch = useDispatch();

  const debounce = useDebouncedCallback((filter: any) => {
    // setFilter(filter);
    dispatch(updateFile({ id: currentFile?.id, tableFilter: filter }));
  }, 1000);

  const handleFilterValueChange = (
    value: string,
    index: number,
    type: keyof typeof initialFilter
  ) => {
    const updatedFilter = JSON.parse(JSON.stringify(filterValues));
    updatedFilter[index][type] = value;
    setFilterValues(updatedFilter);
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableFilter: { filter: filterValues, applyFilter: false },
      })
    );
  };

  const handleAddFilter = (index: number) => {
    const addedFilter = JSON.parse(JSON.stringify(filterValues));
    addedFilter.splice(index + 1, 0, { ...initialFilter, separator: "AND" });
    setFilterValues(addedFilter);
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableFilter: { filter: addedFilter, applyFilter: false },
      })
    );
  };

  const handleRemoveFilter = (index: number) => {
    const removedFilter = JSON.parse(JSON.stringify(filterValues));
    removedFilter.splice(index, 1);
    setFilterValues(removedFilter);
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableFilter: { filter: removedFilter, applyFilter: false },
      })
    );
  };

  const handleApplyFilter = () => {
    // console.log(filterValues);
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableFilter: { filter: filterValues, applyFilter: true },
      })
    );
  };

  useEffect(() => {
    if (currentFile?.tableName)
      setFilterValues(currentFile?.tableFilter?.filter || [initialFilter]);
  }, [currentFile?.tableName, currentFile?.tableFilter?.filter]);

  return (
    <div className="flex-1 flex gap-2 bg-secondary p-4">
      <div className="flex-1 flex flex-col gap-2 bg-secondary">
        {filterValues.map((filterValue: any, index: number) => (
          <div key={index} className="flex gap-2 items-center">
            <Select
              defaultValue={filterValue.separator}
              disabled={index === 0}
              onValueChange={(value) =>
                handleFilterValueChange(value, index, "separator")
              }
            >
              <SelectTrigger className="h-8 text-xs w-[100px] bg-background">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent className="bg-background/70 backdrop-blur-md">
                {index === 0 && (
                  <SelectItem
                    value={"WHERE"}
                    className="text-xs focus:bg-primary/60 cursor-pointer"
                  >
                    <p className="flex items-center gap-2">WHERE</p>
                  </SelectItem>
                )}
                <SelectItem
                  value={"AND"}
                  className="text-xs focus:bg-primary/60 cursor-pointer"
                >
                  <p className="flex items-center gap-2">AND</p>
                </SelectItem>
                <SelectItem
                  value={"OR"}
                  className="text-xs focus:bg-primary/60 cursor-pointer"
                >
                  <p className="flex items-center gap-2">OR</p>
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              defaultValue="id"
              onValueChange={(value) =>
                handleFilterValueChange(value, index, "column")
              }
            >
              <SelectTrigger className="h-8 text-xs w-[140px] bg-background">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent className="bg-background/70 backdrop-blur-md">
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
            <Select
              defaultValue="equals"
              onValueChange={(value) =>
                handleFilterValueChange(value, index, "compare")
              }
            >
              <SelectTrigger className="h-8 text-xs w-[130px] bg-background">
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
              className="flex-1 h-8 !text-xs bg-background"
              value={filterValue.value}
              onChange={(e) =>
                handleFilterValueChange(e.target.value, index, "value")
              }
              placeholder="Enter Value"
            />
            <Button
              variant={"outline"}
              className="h-7 w-7 px-2 border-border [&_svg]:size-3"
              onClick={() => handleAddFilter(index)}
            >
              <PlusIcon />
            </Button>
            {index > 0 && (
              <Button
                variant={"outline"}
                className="h-7 w-7 px-2 border-border [&_svg]:size-3"
                onClick={() => handleRemoveFilter(index)}
              >
                <XIcon />
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="h-8 flex items-center">
        <Button
          variant={"outline"}
          className="h-7 px-2 bg-primary hover:bg-primary/70 border-border [&_svg]:size-3"
          onClick={handleApplyFilter}
        >
          Apply Filter
        </Button>
      </div>
    </div>
  );
};

export default Filter;
