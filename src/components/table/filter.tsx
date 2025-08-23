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
import { useDispatch, useSelector } from "react-redux";
import { updateFile } from "@/redux/features/open-files";
import { Button } from "../ui/button";
import { PlusIcon, XIcon, CalendarIcon } from "lucide-react";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";

interface ColumnProps extends Column<any> {
  data_type?: string;
}

const Filter = ({ columns }: { columns: ColumnProps[] }) => {
  const initialFilter = {
    column: columns[0]?.key || "",
    compare: "equals",
    value: "",
    value2: "", // For between, range operations
    separator: "WHERE",
    isCustomQuery: false, // Flag to indicate if this is a custom SQL query
    customQuery: "", // Custom SQL query text
  };
  const [filterValues, setFilterValues] = React.useState<any>([initialFilter]);

  const { currentFile } = useSelector((state: any) => state.openFiles);
  const dispatch = useDispatch();

  const getColumnDataType = (columnKey: string) => {
    const column = columns.find((col) => col.key === columnKey);
    return column?.data_type?.toLowerCase() || "text";
  };

  const getAvailableComparisons = (dataType: string) => {
    return compareFilter.filter(
      (filter) =>
        filter.types.includes(dataType) || filter.types.includes("all"),
    );
  };

  const needsSecondValue = (compareOperator: string) => {
    return ["between", "not between"].includes(compareOperator);
  };

  const needsNoValue = (compareOperator: string) => {
    return [
      "is null",
      "is not null",
      "is true",
      "is false",
      "is empty",
      "is not empty",
      "is today",
      "is this week",
      "is this month",
      "is this year",
    ].includes(compareOperator);
  };

  const isDateType = (dataType: string) => {
    return ["timestamp", "date", "time", "datetime"].includes(dataType);
  };

  const isNumericType = (dataType: string) => {
    return [
      "integer",
      "int",
      "bigint",
      "smallint",
      "decimal",
      "numeric",
      "float",
      "double",
      "real",
    ].includes(dataType);
  };

  const isBooleanType = (dataType: string) => {
    return ["boolean", "bool"].includes(dataType);
  };

  const isArrayType = (dataType: string) => {
    return ["array", "json", "jsonb"].includes(dataType);
  };

  const renderValueInput = (
    filterValue: any,
    index: number,
    dataType: string,
  ) => {
    const compareOp = filterValue.compare;

    if (needsNoValue(compareOp)) {
      return (
        <p className="flex-1 truncate rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          No value needed
        </p>
      );
    }

    if (needsSecondValue(compareOp)) {
      return (
        <div className="flex flex-1 gap-2">
          <Input
            className="h-8 flex-1 bg-background !text-xs"
            value={filterValue.value}
            onChange={(e) =>
              handleFilterValueChange(e.target.value, index, "value")
            }
            placeholder="Start value"
            type={isNumericType(dataType) ? "number" : "text"}
          />
          <Input
            className="h-8 flex-1 bg-background !text-xs"
            value={filterValue.value2}
            onChange={(e) =>
              handleFilterValueChange(e.target.value, index, "value2")
            }
            placeholder="End value"
            type={isNumericType(dataType) ? "number" : "text"}
          />
        </div>
      );
    }

    if (isDateType(dataType)) {
      return (
        <Input
          className="h-8 bg-background !text-xs"
          value={filterValue.value}
          onChange={(e) =>
            handleFilterValueChange(e.target.value, index, "value")
          }
          placeholder="YYYY-MM-DD or YYYY-MM-DD HH:MM:SS"
          type="text"
        />
      );
    }

    if (isNumericType(dataType)) {
      return (
        <Input
          className="h-8 bg-background !text-xs"
          value={filterValue.value}
          onChange={(e) =>
            handleFilterValueChange(e.target.value, index, "value")
          }
          placeholder="Enter number"
          type="number"
          step="any"
        />
      );
    }

    if (isBooleanType(dataType)) {
      return (
        <div className="flex flex-1 items-center gap-2 px-3 py-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`boolean-${index}`}
              checked={filterValue.value === "true"}
              onCheckedChange={(checked) =>
                handleFilterValueChange(
                  checked ? "true" : "false",
                  index,
                  "value",
                )
              }
            />
            <Label htmlFor={`boolean-${index}`} className="text-xs">
              {filterValue.value === "true" ? "True" : "False"}
            </Label>
          </div>
        </div>
      );
    }

    if (isArrayType(dataType)) {
      return (
        <Input
          className="h-8 bg-background !text-xs"
          value={filterValue.value}
          onChange={(e) =>
            handleFilterValueChange(e.target.value, index, "value")
          }
          placeholder="Enter JSON array or value"
          type="text"
        />
      );
    }

    // Default text input
    return (
      <Input
        className="h-8 bg-background !text-xs"
        value={filterValue.value}
        onChange={(e) =>
          handleFilterValueChange(e.target.value, index, "value")
        }
        placeholder="Enter value"
        type="text"
      />
    );
  };

  const handleFilterValueChange = (
    value: string | boolean,
    index: number,
    type: keyof typeof initialFilter,
  ) => {
    const updatedFilter = JSON.parse(JSON.stringify(filterValues));

    // Handle boolean values for isCustomQuery
    if (type === "isCustomQuery") {
      updatedFilter[index][type] = value === "true" || value === true;
    } else {
      updatedFilter[index][type] = value;
    }

    setFilterValues(updatedFilter);
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableFilter: {
          ...currentFile?.tableFilter,
          filter: {
            oldFilter: currentFile?.tableFilter?.filter?.oldFilter,
            newFilter: updatedFilter,
          },
          applyFilter: false,
        },
      }),
    );
  };

  const handleAddFilter = (index: number) => {
    const addedFilter = JSON.parse(JSON.stringify(filterValues));
    addedFilter.splice(index + 1, 0, { ...initialFilter, separator: "AND" });
    setFilterValues(addedFilter);
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableFilter: {
          ...currentFile?.tableFilter,
          filter: {
            oldFilter: currentFile?.tableFilter?.filter?.oldFilter,
            newFilter: addedFilter,
          },
          applyFilter: false,
        },
      }),
    );
  };

  const handleRemoveFilter = (index: number) => {
    const removedFilter = JSON.parse(JSON.stringify(filterValues));
    removedFilter.splice(index, 1);
    setFilterValues(removedFilter);
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableFilter: {
          ...currentFile?.tableFilter,
          filter: {
            oldFilter: currentFile?.tableFilter?.filter?.oldFilter,
            newFilter: removedFilter,
          },
          applyFilter: false,
        },
      }),
    );
  };

  const handleApplyFilters = () => {
    // Clean up filter values - remove empty filters and validate custom queries
    const cleanedFilters = filterValues.filter((filter: any) => {
      if (filter.isCustomQuery) {
        return filter.customQuery && filter.customQuery.trim();
      } else {
        return (
          filter.column &&
          filter.compare &&
          filter.value !== undefined &&
          filter.value !== ""
        );
      }
    });

    dispatch(
      updateFile({
        id: currentFile?.id,
        tableFilter: {
          ...currentFile?.tableFilter,
          filter: {
            oldFilter: currentFile?.tableFilter?.filter?.oldFilter,
            newFilter: cleanedFilters,
          },
          applyFilter: true,
        },
      }),
    );
  };

  const handleRemoveFilters = () => {
    dispatch(
      updateFile({
        id: currentFile?.id,
        tableFilter: {
          ...currentFile?.tableFilter,
          filter: {
            oldFilter: [],
            newFilter: [],
          },
          applyFilter: true,
        },
      }),
    );
    setFilterValues([initialFilter]);
  };

  useEffect(() => {
    if (currentFile?.tableName) {
      // Only set filter values from oldFilter when switching tables or when no local state exists
      // This prevents overriding user's current filter input with previously applied filters
      if (
        currentFile?.tableFilter?.filter?.oldFilter?.length > 0 &&
        filterValues.length === 0
      ) {
        setFilterValues(currentFile?.tableFilter?.filter?.oldFilter);
      }
      // Check if there are pending filters (newFilter represents filters being built)
      else if (
        currentFile?.tableFilter?.filter?.newFilter?.length > 0 &&
        filterValues.length === 0
      ) {
        setFilterValues(currentFile?.tableFilter?.filter?.newFilter);
      }
      // Default to initial filter only if no filters exist at all and no local state
      else if (filterValues.length === 0) {
        const newInitialFilter = {
          column: columns[0]?.key || "",
          compare: "equals",
          value: "",
          value2: "",
          separator: "WHERE",
          isCustomQuery: false,
          customQuery: "",
        };
        setFilterValues([newInitialFilter]);
      }
    }
  }, [currentFile?.tableName, columns, filterValues.length]);

  return (
    <div>
      {/* Custom Query Toggle - Always visible at the top */}
      <div className="mb-2 flex items-center gap-2">
        <Checkbox
          id="custom-query-toggle"
          checked={filterValues[0]?.isCustomQuery || false}
          onCheckedChange={(checked) => {
            const updatedFilter = JSON.parse(JSON.stringify(filterValues));
            // Update all filters to have the same custom query state
            updatedFilter.forEach((filter: any) => {
              filter.isCustomQuery = checked;
              if (checked) {
                filter.customQuery = "";
              } else {
                filter.value = "";
                filter.value2 = "";
              }
            });
            setFilterValues(updatedFilter);
          }}
        />
        <Label
          htmlFor="custom-query-toggle"
          className="whitespace-nowrap text-xs"
        >
          Custom SQL
        </Label>
      </div>
      <div className="flex flex-1 gap-2">
        <div className="flex flex-1 flex-col gap-2">
          {/* Custom Query Input - Show when custom query is enabled */}
          {filterValues[0]?.isCustomQuery ? (
            <div className="flex items-center gap-2">
              <Input
                className="h-8 flex-1 bg-background !text-xs"
                value={filterValues[0]?.customQuery || ""}
                onChange={(e) =>
                  handleFilterValueChange(e.target.value, 0, "customQuery")
                }
                placeholder="PostgreSQL: age > 25 AND status = 'active' | MongoDB: age > 25"
                type="text"
              />
            </div>
          ) : (
            /* Regular Filter Controls - Only show when custom query is disabled */
            filterValues.map((filterValue: any, index: number) => {
              const dataType = getColumnDataType(filterValue.column);
              const availableComparisons = getAvailableComparisons(dataType);

              return (
                <div key={index} className="flex items-center gap-2">
                  <Select
                    value={filterValue.separator}
                    disabled={index === 0}
                    onValueChange={(value) =>
                      handleFilterValueChange(value, index, "separator")
                    }
                  >
                    <SelectTrigger className="h-8 w-[100px] bg-background text-xs">
                      <SelectValue placeholder="Filter" />
                    </SelectTrigger>
                    <SelectContent className="bg-background/70 backdrop-blur-md">
                      {index === 0 && (
                        <SelectItem
                          value={"WHERE"}
                          className="cursor-pointer text-xs focus:bg-primary/60"
                        >
                          <p className="flex items-center gap-2">WHERE</p>
                        </SelectItem>
                      )}
                      <SelectItem
                        value={"AND"}
                        className="cursor-pointer text-xs focus:bg-primary/60"
                      >
                        <p className="flex items-center gap-2">AND</p>
                      </SelectItem>
                      <SelectItem
                        value={"OR"}
                        className="cursor-pointer text-xs focus:bg-primary/60"
                      >
                        <p className="flex items-center gap-2">OR</p>
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    defaultValue={columns?.[0]?.key || "id"}
                    value={filterValue.column}
                    onValueChange={(value) =>
                      handleFilterValueChange(value, index, "column")
                    }
                  >
                    <SelectTrigger className="h-8 w-[140px] bg-background text-xs">
                      <SelectValue placeholder="Column" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns?.map((column: ColumnProps) => {
                        const Icon =
                          TypeIcons[
                            column.data_type?.toLowerCase() as TypeIconsType
                          ];
                        return (
                          <SelectItem
                            key={column.key}
                            value={column.key}
                            className="cursor-pointer text-xs"
                          >
                            <p className="flex items-center gap-2">
                              {Icon && (
                                <Icon size={14} className="text-yellow-400" />
                              )}
                              {column.name}
                            </p>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>

                  <Select
                    value={filterValue.compare}
                    onValueChange={(value) =>
                      handleFilterValueChange(value, index, "compare")
                    }
                  >
                    <SelectTrigger className="h-8 w-[130px] bg-background text-xs">
                      <SelectValue placeholder="Operator" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableComparisons?.map((filter) => (
                        <SelectItem
                          key={filter.key}
                          value={filter.key}
                          className="cursor-pointer text-xs"
                        >
                          {filter.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleApplyFilters();
                    }}
                    className="flex-1"
                  >
                    {renderValueInput(filterValue, index, dataType)}
                  </form>

                  <Button
                    variant={"outline"}
                    className="h-7 w-7 border-border px-2 [&_svg]:size-3"
                    onClick={() => handleAddFilter(index)}
                  >
                    <PlusIcon />
                  </Button>
                  {index > 0 && (
                    <Button
                      variant={"outline"}
                      className="h-7 w-7 border-border px-2 [&_svg]:size-3"
                      onClick={() => handleRemoveFilter(index)}
                    >
                      <XIcon />
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="flex h-8 items-center gap-2">
          <Button
            variant={"outline"}
            className="h-7 border-border bg-primary px-2 hover:bg-primary/70 [&_svg]:size-3"
            onClick={handleApplyFilters}
          >
            Apply
          </Button>
          {currentFile?.tableFilter?.filter?.oldFilter?.length > 0 && (
            <Button
              variant={"outline"}
              className="h-7 border-border px-2 [&_svg]:size-3"
              onClick={handleRemoveFilters}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Filter;
